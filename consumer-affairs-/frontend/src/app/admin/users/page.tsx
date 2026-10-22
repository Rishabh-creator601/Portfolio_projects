'use client';

import React, { useState } from 'react';
import { Table, Column } from '@/components/ui/Table';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { SearchBar } from '@/components/ui/SearchBar';
import { useApi } from '@/lib/hooks';
import { userService } from '@/lib/services';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { PASSWORD_RULES, ROLE_LABELS, formatDate } from '@/lib/constants';
import type { User, UserRole } from '@/types/user';
import { AlertCircle, Check, UserPlus, X } from 'lucide-react';

const ROLE_CHIP: Record<string, string> = {
  field_inspector: 'border-cyan-200 bg-cyan-50 text-cyan-800',
  senior_inspector: 'border-cyan-300 bg-cyan-100 text-cyan-900',
  controller: 'border-cyan-400 bg-cyan-200/70 text-cyan-950',
  legal_officer: 'border-verdict-review/25 bg-verdict-review/10 text-verdict-review',
  auditor: 'border-slate-200 bg-slate-100 text-slate-700',
};

interface FormState {
  displayName: string;
  email: string;
  password: string;
  role: UserRole;
  jurisdiction: string;
  isActive: boolean;
}

const emptyForm: FormState = {
  displayName: '',
  email: '',
  password: '',
  role: 'field_inspector',
  jurisdiction: '',
  isActive: true,
};

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const users = useApi(() => userService.list({ search }), [search]);
  const isController = currentUser?.role === 'controller';

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEdit = (u: User) => {
    setEditing(u);
    setForm({
      displayName: u.displayName || '',
      email: u.email,
      password: '',
      role: u.role,
      jurisdiction: u.jurisdiction || '',
      isActive: u.isActive,
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSaving(true);

    try {
      if (editing) {
        await userService.update(editing._id, {
          displayName: form.displayName,
          role: form.role,
          jurisdiction: form.jurisdiction,
          isActive: form.isActive,
        });
      } else {
        await userService.create({
          displayName: form.displayName,
          email: form.email,
          password: form.password,
          role: form.role,
          jurisdiction: form.jurisdiction,
        });
      }

      setIsModalOpen(false);
      users.reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save this account.');
    } finally {
      setIsSaving(false);
    }
  };

  const columns: Column<User>[] = [
    {
      key: 'displayName',
      label: 'Officer',
      sortable: true,
      render: (u) => (
        <div>
          <p className="font-medium text-cyan-950">{u.displayName || '—'}</p>
          <p className="text-xs text-slate-500">{u.email}</p>
        </div>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      render: (u) => (
        <span className={`chip ${ROLE_CHIP[u.role] || ROLE_CHIP.auditor}`}>
          {ROLE_LABELS[u.role] || u.role}
        </span>
      ),
    },
    { key: 'jurisdiction', label: 'Jurisdiction' },
    {
      key: 'isActive',
      label: 'Status',
      render: (u) => (
        <span
          className={`chip ${
            u.isActive
              ? 'border-verdict-pass/25 bg-verdict-pass/10 text-verdict-pass'
              : 'border-slate-200 bg-slate-100 text-slate-600'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${u.isActive ? 'bg-verdict-pass' : 'bg-slate-400'}`}
            aria-hidden="true"
          />
          {u.isActive ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    { key: 'lastLogin', label: 'Last login', render: (u) => formatDate(u.lastLogin) },
    {
      key: 'actions',
      label: 'Actions',
      align: 'right',
      render: (u) =>
        isController ? (
          <button
            onClick={() => openEdit(u)}
            className="focus-ring rounded px-2 py-1 text-sm font-medium text-cyan-700 hover:text-cyan-900"
          >
            Edit
          </button>
        ) : (
          <span className="text-xs text-slate-400">Read only</span>
        ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl p-4 lg:p-8">
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="page-title">User management</h1>
          <p className="page-subtitle">Provision officer accounts, roles and jurisdictions.</p>
        </div>
        {isController && (
          <Button onClick={openCreate}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Add officer
          </Button>
        )}
      </div>

      <div className="card mb-6 p-4">
        <SearchBar onSearch={setSearch} placeholder="Search by name or email…" />
      </div>

      <Table
        columns={columns}
        data={users.data ?? []}
        isLoading={users.isLoading}
        error={users.error}
        onRetry={users.reload}
        emptyMessage="No officer accounts found."
      />

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editing ? 'Edit officer' : 'Add officer'}
        description={
          editing
            ? 'Changing a role or deactivating an account signs that officer out immediately.'
            : 'The officer signs in with the email and password you set here.'
        }
      >
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          {formError && (
            <div className="flex items-start gap-2 rounded-lg border border-verdict-fail/25 bg-verdict-fail/5 p-3 text-sm text-verdict-fail">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span>{formError}</span>
            </div>
          )}

          <div>
            <label htmlFor="displayName" className="label">
              Full name
            </label>
            <input
              id="displayName"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              required
              minLength={2}
              className="input"
            />
          </div>

          <div>
            <label htmlFor="email" className="label">
              Official email
            </label>
            <input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              disabled={!!editing}
              className="input disabled:bg-slate-50 disabled:text-slate-500"
            />
          </div>

          {!editing && (
            <div>
              <label htmlFor="password" className="label">
                Temporary password
              </label>
              <input
                id="password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                className="input"
                autoComplete="new-password"
              />
              <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                {PASSWORD_RULES.map((rule) => {
                  const met = rule.test(form.password);
                  return (
                    <li
                      key={rule.label}
                      className={`flex items-center gap-1.5 text-xs ${
                        met ? 'text-verdict-pass' : 'text-slate-500'
                      }`}
                    >
                      {met ? (
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <X className="h-3.5 w-3.5 opacity-50" aria-hidden="true" />
                      )}
                      {rule.label}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div>
            <label htmlFor="role" className="label">
              Role
            </label>
            <select
              id="role"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
              className="input"
            >
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="jurisdiction" className="label">
              Jurisdiction
            </label>
            <input
              id="jurisdiction"
              value={form.jurisdiction}
              onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })}
              required
              className="input"
            />
          </div>

          {editing && (
            <label className="flex items-center gap-2 text-sm font-medium text-cyan-900">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="h-4 w-4 rounded border-cyan-300 text-cyan-bright focus:ring-cyan-bright"
              />
              Account is active
            </label>
          )}

          <div className="mt-2 flex justify-end gap-3 border-t border-cyan-100 pt-4">
            <Button type="button" variant="secondary" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSaving}>
              {editing ? 'Save changes' : 'Create account'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
