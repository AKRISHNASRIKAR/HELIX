'use client';

import { useRef } from 'react';
import { switchOrgAction } from '../lib/actions/auth';
import type { Membership } from '../lib/api';

/** Org picker shown when the user belongs to more than one organization. Submits on change. */
export function OrgSwitcher({ memberships, activeId }: { memberships: Membership[]; activeId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={switchOrgAction}>
      <label htmlFor="org-switcher" className="sr-only">
        Active organization
      </label>
      <select
        id="org-switcher"
        name="organizationId"
        defaultValue={activeId}
        onChange={() => formRef.current?.requestSubmit()}
        className="-ml-1 max-w-full cursor-pointer truncate rounded-md bg-transparent py-0.5 transition-colors pl-1 pr-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        {memberships.map((m) => (
          <option key={m.organizationId} value={m.organizationId}>
            {m.organizationName}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="text-[11px] underline">
          Switch
        </button>
      </noscript>
    </form>
  );
}
