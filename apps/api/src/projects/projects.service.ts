import { Injectable, NotFoundException } from '@nestjs/common';
import type { Project } from '@helix/database';
import { PrismaService } from '../prisma/prisma.service';

export interface ProjectView {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const toView = (p: Project): ProjectView => ({
  id: p.id,
  name: p.name,
  description: p.description,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string): Promise<ProjectView[]> {
    const rows = await this.prisma.project.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toView);
  }

  async get(organizationId: string, id: string): Promise<ProjectView> {
    return toView(await this.findOwned(organizationId, id));
  }

  async create(
    organizationId: string,
    input: { name: string; description?: string | null },
  ): Promise<ProjectView> {
    const p = await this.prisma.project.create({
      data: { organizationId, name: input.name, description: input.description ?? null },
    });
    return toView(p);
  }

  async update(
    organizationId: string,
    id: string,
    input: { name?: string; description?: string | null },
  ): Promise<ProjectView> {
    await this.findOwned(organizationId, id);
    return toView(await this.prisma.project.update({ where: { id }, data: input }));
  }

  /** Cascades to the project's investigations (schema onDelete: Cascade). */
  async remove(organizationId: string, id: string): Promise<void> {
    await this.findOwned(organizationId, id);
    await this.prisma.project.delete({ where: { id } });
  }

  private async findOwned(organizationId: string, id: string): Promise<Project> {
    const p = await this.prisma.project.findFirst({ where: { id, organizationId } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }
}
