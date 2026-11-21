import { INestApplication } from '@nestjs/common';
import { existsSync } from 'node:fs';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { UpstreamError } from '../src/clients/http';
import { InvestigationRunnerService } from '../src/runner/investigation-runner.service';
import {
  API,
  as,
  createApp,
  createOrg,
  mockClients,
  ORDERS_SCHEMA,
  signup,
  TestUser,
} from './helpers';

/**
 * Phase 1 definition of done, end to end against helix_test: signup, login,
 * org, project, data source, investigation; tenant isolation; role
 * enforcement; audit rows on every mutation.
 */
describe('Core platform (e2e)', () => {
  const mocks = mockClients();
  let app: INestApplication;
  let prisma: PrismaService;
  let alice: TestUser;
  let bob: TestUser;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    app = await createApp(mocks);
    prisma = app.get(PrismaService);
    // Runs are covered in runner.e2e-spec; here the runtime is just "down".
    mocks.agentRuntime.runInvestigation.mockRejectedValue(new UpstreamError('unreachable', null));
    alice = await signup(app, 'alice');
    bob = await signup(app, 'bob');
    orgA = await createOrg(app, alice, 'Alice Co');
    orgB = await createOrg(app, bob, 'Bob Co');
  });

  afterAll(async () => {
    await app.get(InvestigationRunnerService).whenIdle();
    await app.close();
  });

  const auditCount = (where: Record<string, unknown>) => prisma.auditLog.count({ where });

  describe('auth', () => {
    it('rejects unauthenticated requests', async () => {
      await request(app.getHttpServer()).get(`${API}/auth/me`).expect(401);
      await request(app.getHttpServer())
        .get(`${API}/projects`)
        .set('X-Organization-Id', orgA)
        .expect(401);
    });

    it('logs in with the right password only', async () => {
      const ok = await request(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: alice.email, password: 'correct-horse-battery' })
        .expect(200);
      expect(ok.body).toMatchObject({
        user: { id: alice.id, email: alice.email },
        accessToken: expect.any(String),
      });
      await request(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: alice.email, password: 'wrong-password' })
        .expect(401);
      await request(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: 'nobody@e2e.helix.test', password: 'whatever!' })
        .expect(401);
    });

    it('409s on a duplicate email and 400s on a short password', async () => {
      await request(app.getHttpServer())
        .post(`${API}/auth/signup`)
        .send({ email: alice.email, name: 'dup', password: 'long-enough-pw' })
        .expect(409);
      const bad = await request(app.getHttpServer())
        .post(`${API}/auth/signup`)
        .send({ email: 'x@e2e.helix.test', name: 'x', password: 'short' })
        .expect(400);
      expect(bad.body.issues[0].path).toBe('password');
    });

    it('GET /auth/me lists memberships', async () => {
      const res = await as(app, alice).get('/auth/me').expect(200);
      expect(res.body.user.id).toBe(alice.id);
      expect(res.body.memberships).toEqual([
        expect.objectContaining({
          organizationId: orgA,
          organizationName: 'Alice Co',
          role: 'OWNER',
        }),
      ]);
    });

    it('audits signup and login', async () => {
      expect(await auditCount({ userId: alice.id, action: 'user.signup' })).toBe(1);
      expect(await auditCount({ userId: alice.id, action: 'auth.login' })).toBeGreaterThanOrEqual(
        1,
      );
    });
  });

  describe('Phase 1 happy path', () => {
    it('org -> project -> data source -> investigation, all audited', async () => {
      const orgs = await as(app, alice).get('/organizations').expect(200);
      expect(orgs.body).toEqual([expect.objectContaining({ id: orgA, role: 'OWNER' })]);
      expect(
        await auditCount({ organizationId: orgA, action: 'organization.create', resourceId: orgA }),
      ).toBe(1);

      const a = as(app, alice, orgA);
      const project = await a
        .post('/projects')
        .send({ name: 'Revenue', description: 'Q4' })
        .expect(201);
      expect(project.body).toMatchObject({ name: 'Revenue', description: 'Q4' });
      expect(project.body.organizationId).toBeUndefined();

      mocks.ingestion.connect.mockResolvedValueOnce({ ok: true, schemas: [ORDERS_SCHEMA] });
      const ds = await a
        .post('/data-sources')
        .send({
          name: 'warehouse',
          type: 'POSTGRESQL',
          config: { host: 'db.internal', port: 5432, database: 'analytics' },
          credentials: { user: 'reader', password: 's3cret' },
        })
        .expect(201);
      expect(ds.body).toMatchObject({
        name: 'warehouse',
        status: 'CONNECTED',
        tables: 1,
        statusMessage: null,
      });
      expect(ds.body.schemas[0]).toMatchObject({ tableName: 'orders', rowCountEstimate: 25000 });
      expect(JSON.stringify(ds.body)).not.toContain('s3cret');
      // The ingestion service got the decrypted credentials; the DB only has ciphertext.
      expect(mocks.ingestion.connect.mock.calls.at(-1)[0]).toMatchObject({
        type: 'POSTGRESQL',
        credentials: { user: 'reader', password: 's3cret' },
      });
      const cred = await prisma.dataSourceCredential.findUniqueOrThrow({
        where: { dataSourceId: ds.body.id },
      });
      expect(cred.ciphertext).not.toContain('s3cret');
      const row = await prisma.dataSource.findUniqueOrThrow({ where: { id: ds.body.id } });
      expect(JSON.stringify(row.connectionConfig)).not.toContain('s3cret');

      const inv = await a
        .post('/investigations')
        .send({ projectId: project.body.id, question: 'Why did revenue drop last week?' })
        .expect(201);
      expect(inv.body).toMatchObject({
        status: 'PENDING',
        triggerType: 'USER_QUESTION',
        createdByUserId: alice.id,
        organizationId: orgA,
      });

      const list = await a.get('/investigations').expect(200);
      expect(list.body.map((i: { id: string }) => i.id)).toContain(inv.body.id);

      for (const [action, resourceId] of [
        ['project.create', project.body.id],
        ['data_source.create', ds.body.id],
        ['investigation.create', inv.body.id],
      ]) {
        expect(
          await auditCount({ organizationId: orgA, userId: alice.id, action, resourceId }),
        ).toBe(1);
      }

      const summary = await a.get('/dashboard/summary').expect(200);
      expect(summary.body).toMatchObject({ dataSources: 1, connectedDataSources: 1, projects: 1 });
      expect(summary.body.totalInvestigations).toBeGreaterThanOrEqual(1);
    });

    it('records an ERROR status (not a 500) when ingestion rejects or is down', async () => {
      const a = as(app, alice, orgA);
      mocks.ingestion.connect.mockResolvedValueOnce({
        ok: false,
        error: 'password authentication failed',
      });
      const bad = await a
        .post('/data-sources')
        .send({
          name: 'bad-creds',
          type: 'POSTGRESQL',
          config: { host: 'h', database: 'd' },
          credentials: { user: 'u', password: 'p' },
        })
        .expect(201);
      expect(bad.body).toMatchObject({
        status: 'ERROR',
        statusMessage: 'password authentication failed',
      });

      mocks.ingestion.connect.mockRejectedValueOnce(
        new UpstreamError('http://localhost:8004 unreachable: ECONNREFUSED', null),
      );
      const down = await a
        .post('/data-sources')
        .send({
          name: 'down',
          type: 'POSTGRESQL',
          config: { host: 'h', database: 'd' },
          credentials: { user: 'u', password: 'p' },
        })
        .expect(201);
      expect(down.body.status).toBe('ERROR');
      expect(down.body.statusMessage).toMatch(/Ingestion service unavailable/);

      // Re-sync once the source is reachable.
      mocks.ingestion.connect.mockResolvedValueOnce({ ok: true, schemas: [ORDERS_SCHEMA] });
      const synced = await a.post(`/data-sources/${down.body.id}/sync`).expect(200);
      expect(synced.body).toMatchObject({ status: 'CONNECTED', statusMessage: null, tables: 1 });

      await a.delete(`/data-sources/${bad.body.id}`).expect(204);
      await a.delete(`/data-sources/${down.body.id}`).expect(204);
      expect(await auditCount({ action: 'data_source.delete', resourceId: down.body.id })).toBe(1);
    });

    it('uploads a CSV to HELIX_UPLOAD_DIR under a uuid name', async () => {
      const a = as(app, alice, orgA);
      mocks.ingestion.connect.mockResolvedValueOnce({ ok: true, schemas: [ORDERS_SCHEMA] });
      const res = await a
        .post('/data-sources/upload')
        .field('name', 'orders export')
        .attach('file', Buffer.from('order_id,amount\n1,10.5\n'), 'Orders Q4.csv')
        .expect(201);
      expect(res.body).toMatchObject({ name: 'orders export', type: 'CSV', status: 'CONNECTED' });
      expect(res.body.config).toMatchObject({
        originalName: 'Orders Q4.csv',
        fileId: expect.any(String),
      });

      const spec = mocks.ingestion.connect.mock.calls.at(-1)[0];
      expect(spec.type).toBe('CSV');
      expect(spec.filePath).toBe(`${process.env.HELIX_UPLOAD_DIR}/${res.body.config.fileId}.csv`);
      expect(existsSync(spec.filePath)).toBe(true);

      await a
        .post('/data-sources/upload')
        .attach('file', Buffer.from('not a csv'), 'evil.exe')
        .expect(400);

      await a.delete(`/data-sources/${res.body.id}`).expect(204);
      expect(existsSync(spec.filePath)).toBe(false);
    });
  });

  describe('organization isolation', () => {
    let aliceProject: string;
    let aliceDs: string;
    let aliceInv: string;

    beforeAll(async () => {
      const a = as(app, alice, orgA);
      aliceProject = (await a.post('/projects').send({ name: 'Private' }).expect(201)).body.id;
      mocks.ingestion.connect.mockResolvedValueOnce({ ok: true, schemas: [] });
      aliceDs = (
        await a
          .post('/data-sources')
          .send({
            name: 'private-db',
            type: 'POSTGRESQL',
            config: { host: 'h', database: 'd' },
            credentials: { user: 'u', password: 'p' },
          })
          .expect(201)
      ).body.id;
      aliceInv = (
        await a
          .post('/investigations')
          .send({ projectId: aliceProject, question: 'Private question?' })
          .expect(201)
      ).body.id;
    });

    it("403s when Bob sends Alice's org id", async () => {
      const b = as(app, bob, orgA);
      await b.get('/projects').expect(403);
      await b.get('/data-sources').expect(403);
      await b.get('/investigations').expect(403);
      await b.get(`/investigations/${aliceInv}`).expect(403);
      await b.get(`/organizations/${orgA}/members`).expect(403);
    });

    it("404s when Bob asks for Alice's resources inside his own org", async () => {
      const b = as(app, bob, orgB);
      await b.get(`/projects/${aliceProject}`).expect(404);
      await b.get(`/data-sources/${aliceDs}`).expect(404);
      await b.get(`/investigations/${aliceInv}`).expect(404);
      await b.patch(`/investigations/${aliceInv}`).send({ status: 'CANCELLED' }).expect(404);
      await b.delete(`/data-sources/${aliceDs}`).expect(404);
      // Can't attach an investigation to someone else's project either.
      await b
        .post('/investigations')
        .send({ projectId: aliceProject, question: 'Sneaky?' })
        .expect(404);

      const lists = await Promise.all(
        ['/projects', '/data-sources', '/investigations'].map((p) => b.get(p).expect(200)),
      );
      for (const l of lists) expect(l.body).toEqual([]);
    });

    it('requires the X-Organization-Id header on tenant routes', async () => {
      await as(app, alice).get('/projects').expect(400);
    });
  });

  describe('roles', () => {
    let viewer: TestUser;
    let admin: TestUser;
    let projectId: string;

    beforeAll(async () => {
      viewer = await signup(app, 'viewer');
      admin = await signup(app, 'admin');
      const owner = as(app, alice);
      await owner
        .post(`/organizations/${orgA}/members`)
        .send({ email: viewer.email, role: 'VIEWER' })
        .expect(201);
      await owner
        .post(`/organizations/${orgA}/members`)
        .send({ email: admin.email, role: 'ADMIN' })
        .expect(201);
      projectId = (await as(app, alice, orgA).post('/projects').send({ name: 'Roles' }).expect(201))
        .body.id;
    });

    it('lets a VIEWER read but not mutate', async () => {
      const v = as(app, viewer, orgA);
      await v.get('/projects').expect(200);
      await v.get('/investigations').expect(200);
      await v.post('/projects').send({ name: 'nope' }).expect(403);
      await v.patch(`/projects/${projectId}`).send({ name: 'nope' }).expect(403);
      await v.delete(`/projects/${projectId}`).expect(403);
      await v.post('/investigations').send({ projectId, question: 'Can I?' }).expect(403);
      await v
        .post('/data-sources')
        .send({
          name: 'x',
          type: 'POSTGRESQL',
          config: { host: 'h', database: 'd' },
          credentials: { user: 'u', password: 'p' },
        })
        .expect(403);
      await as(app, viewer)
        .post(`/organizations/${orgA}/members`)
        .send({ email: bob.email })
        .expect(403);
      // Nothing got audited for the rejected attempts.
      expect(await auditCount({ userId: viewer.id, organizationId: orgA })).toBe(0);
    });

    it('lets an ADMIN manage members but not grant OWNER', async () => {
      const ad = as(app, admin);
      await ad
        .post(`/organizations/${orgA}/members`)
        .send({ email: bob.email, role: 'OWNER' })
        .expect(403);
      await ad
        .post(`/organizations/${orgA}/members`)
        .send({ email: bob.email, role: 'MEMBER' })
        .expect(201);
      await ad
        .patch(`/organizations/${orgA}/members/${bob.id}`)
        .send({ role: 'VIEWER' })
        .expect(200);
      await ad
        .patch(`/organizations/${orgA}/members/${alice.id}`)
        .send({ role: 'MEMBER' })
        .expect(403);
      await ad.delete(`/organizations/${orgA}/members/${bob.id}`).expect(204);
      await ad
        .post(`/organizations/${orgA}/members`)
        .send({ email: 'ghost@e2e.helix.test' })
        .expect(404);
      expect(
        await auditCount({
          organizationId: orgA,
          action: 'organization.member.remove',
          resourceId: bob.id,
        }),
      ).toBe(1);
    });

    it('never removes the last OWNER', async () => {
      await as(app, alice).delete(`/organizations/${orgA}/members/${alice.id}`).expect(400);
    });
  });

  describe('investigations', () => {
    it('cancels, then refuses a second cancel with 409', async () => {
      const a = as(app, alice, orgA);
      const projectId = (await a.post('/projects').send({ name: 'Cancel' }).expect(201)).body.id;
      // Hold the run so the investigation is still active when we cancel it.
      let release: (v: unknown) => void = () => undefined;
      mocks.agentRuntime.runInvestigation.mockImplementationOnce(
        () => new Promise((r) => (release = r)),
      );
      const inv = (
        await a.post('/investigations').send({ projectId, question: 'Cancel me?' }).expect(201)
      ).body;

      const cancelled = await a
        .patch(`/investigations/${inv.id}`)
        .send({ status: 'CANCELLED' })
        .expect(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      await a.patch(`/investigations/${inv.id}`).send({ status: 'CANCELLED' }).expect(409);
      await a.patch(`/investigations/${inv.id}`).send({ status: 'COMPLETED' }).expect(400);

      release({ status: 'WHATEVER' });
      await app.get(InvestigationRunnerService).whenIdle();
      const detail = await a.get(`/investigations/${inv.id}`).expect(200);
      expect(detail.body.status).toBe('CANCELLED');
      expect(detail.body.events.map((e: { type: string }) => e.type)).toEqual(
        expect.arrayContaining(['investigation.created', 'investigation.cancelled']),
      );
      expect(await auditCount({ action: 'investigation.cancel', resourceId: inv.id })).toBe(1);
    });
  });

  describe('internal endpoints', () => {
    const internal = () => request(app.getHttpServer());

    it('require the internal token', async () => {
      await internal()
        .get(`${API}/internal/data-sources/${orgA}/connection?organizationId=${orgA}`)
        .expect(401);
      await internal()
        .get(`${API}/internal/data-sources/${orgA}/connection?organizationId=${orgA}`)
        .set('x-helix-internal-token', 'wrong')
        .expect(401);
    });

    it('A1 returns decrypted credentials, scoped by organization', async () => {
      mocks.ingestion.connect.mockResolvedValueOnce({ ok: true, schemas: [] });
      const ds = (
        await as(app, alice, orgA)
          .post('/data-sources')
          .send({
            name: 'a1',
            type: 'POSTGRESQL',
            config: { host: 'h', port: 6543, database: 'd' },
            credentials: { user: 'u', password: 'pw' },
          })
          .expect(201)
      ).body;
      const res = await internal()
        .get(`${API}/internal/data-sources/${ds.id}/connection?organizationId=${orgA}`)
        .set('x-helix-internal-token', 'e2e-internal-token')
        .expect(200);
      expect(res.body).toEqual({
        id: ds.id,
        organizationId: orgA,
        type: 'POSTGRESQL',
        config: { host: 'h', port: 6543, database: 'd' },
        credentials: { user: 'u', password: 'pw' },
        filePath: null,
      });
      await internal()
        .get(`${API}/internal/data-sources/${ds.id}/connection?organizationId=${orgB}`)
        .set('x-helix-internal-token', 'e2e-internal-token')
        .expect(404);
    });

    it('A2 applies status and appends events, but never revives a terminal investigation', async () => {
      const a = as(app, alice, orgA);
      const projectId = (await a.post('/projects').send({ name: 'Progress' }).expect(201)).body.id;
      let release: (v: unknown) => void = () => undefined;
      mocks.agentRuntime.runInvestigation.mockImplementationOnce(
        () => new Promise((r) => (release = r)),
      );
      const inv = (
        await a.post('/investigations').send({ projectId, question: 'Progress?' }).expect(201)
      ).body;
      const progress = (body: unknown) =>
        internal()
          .post(`${API}/internal/investigations/${inv.id}/progress`)
          .set('x-helix-internal-token', 'e2e-internal-token')
          .send(body);

      await progress({ status: 'PLANNING', event: { type: 'investigation.planning' } }).expect(204);
      await progress({
        status: 'IN_PROGRESS',
        event: { type: 'task.dispatched', payload: { taskId: 't' }, at: '2026-10-14T09:00:00Z' },
      }).expect(204);
      let row = await prisma.investigation.findUniqueOrThrow({ where: { id: inv.id } });
      expect(row.status).toBe('IN_PROGRESS');
      expect(row.startedAt).not.toBeNull();
      const ev = await prisma.investigationEvent.findFirstOrThrow({
        where: { investigationId: inv.id, type: 'task.dispatched' },
      });
      expect(ev.createdAt.toISOString()).toBe('2026-10-14T09:00:00.000Z');

      await a.patch(`/investigations/${inv.id}`).send({ status: 'CANCELLED' }).expect(200);
      await progress({ status: 'IN_PROGRESS' }).expect(204);
      row = await prisma.investigation.findUniqueOrThrow({ where: { id: inv.id } });
      expect(row.status).toBe('CANCELLED');

      await progress({ status: 'NOPE' }).expect(400);
      release({});
      await app.get(InvestigationRunnerService).whenIdle();
    });
  });

  describe('notifications', () => {
    it('lists, marks read, and isolates per user', async () => {
      const n = await prisma.notification.create({
        data: {
          userId: alice.id,
          organizationId: orgA,
          type: 'test',
          title: 'Hello',
          body: 'World',
        },
      });
      const unread = await as(app, alice).get('/notifications?unread=true').expect(200);
      expect(unread.body.map((x: { id: string }) => x.id)).toContain(n.id);
      await as(app, bob).post(`/notifications/${n.id}/read`).expect(404);
      await as(app, alice).post(`/notifications/${n.id}/read`).expect(204);
      const after = await as(app, alice).get('/notifications?unread=true').expect(200);
      expect(after.body.map((x: { id: string }) => x.id)).not.toContain(n.id);
      await as(app, alice).post('/notifications/read-all').expect(204);
      expect(
        (await as(app, alice, orgA).get('/dashboard/summary').expect(200)).body.unreadNotifications,
      ).toBe(0);
      expect(
        await auditCount({ userId: alice.id, action: 'notification.read', resourceId: n.id }),
      ).toBe(1);
    });
  });

  describe('agents', () => {
    it('falls back to UNAVAILABLE agents when the runtime is down', async () => {
      mocks.agentRuntime.listAgents.mockRejectedValueOnce(new UpstreamError('down', null));
      const res = await as(app, alice, orgA).get('/agents').expect(200);
      expect(res.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'COORDINATOR', status: 'UNAVAILABLE', tasks: 0 }),
        ]),
      );
    });
  });
});
