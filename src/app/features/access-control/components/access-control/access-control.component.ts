import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { AccessControlService } from '../../../../core/services/access-control.service';
import { AccessPermission, AccessPermissionGroup, AccessRole, AccessUser } from '../../../../core/models/access-control.model';
import { AuthService } from '../../../../core/services/auth.service';

type AccessTabKey = 'roles' | 'menu' | 'permissions' | 'users';

/** One row in the permission matrix — one screen/tab per row */
interface PermissionMatrixRow {
  /** Unique key for this row (matches tab or screen key) */
  key: string;
  /** Human-readable label */
  label: string;
  /** The single "view" permission for this row, if any */
  viewPermission: AccessPermission | null;
  /** The single "edit" permission for this row, if any */
  editPermission: AccessPermission | null;
  /** All field-level permissions belonging to this row */
  fieldPermissions: AccessPermission[];
  /** All action-level permissions (lock_baseline, generate_report, etc.) */
  actionPermissions: AccessPermission[];
  /** Child rows — used for tabs that have sub-tabs (Storage, Payment & Costing) */
  children?: PermissionMatrixRow[];
}

/** Describes how to build a matrix row from the flat permission list */
interface RowDefinition {
  key: string;
  label: string;
  /** Match permissions by tab value; if omitted, match by screen */
  tabKey?: string;
  /** Match permissions by screen value (used when tabKey is absent) */
  screenKey?: string;
  /** Explicit action keys that represent "view" for this row */
  viewActionKey?: string;
  /** Explicit action keys that represent "edit" for this row */
  editActionKey?: string;
  /** Explicit permission key overrides for cases where a child row reuses a parent permission */
  viewPermissionKey?: string;
  editPermissionKey?: string;
  children?: RowDefinition[];
  hiddenPermissionKeys?: string[];
}

@Component({
  selector: 'app-access-control',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './access-control.component.html',
  styleUrl: './access-control.component.scss',
})
export class AccessControlComponent {
  private accessControlService = inject(AccessControlService);
  private authService = inject(AuthService);

  readonly activeTab = signal<AccessTabKey>('roles');
  readonly rolesLoading = signal(false);
  readonly permissionsLoading = signal(false);
  readonly usersLoading = signal(false);
  readonly saveLoading = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal<string | null>(null);

  readonly roles = signal<AccessRole[]>([]);
  readonly selectedRoleId = signal<string | null>(null);
  readonly permissionGroups = signal<AccessPermissionGroup[]>([]);
  readonly users = signal<AccessUser[]>([]);
  readonly selectedUserId = signal<string | null>(null);

  /** Tracks which matrix rows are expanded (by row key) */
  readonly expandedRowKeys = signal<Set<string>>(new Set());

  readonly roleForm = signal({ key: '', name: '', description: '', isActive: true });
  readonly editingRoleId = signal<string | null>(null);
  readonly userForm = signal({ email: '', name: '', role: '', isActive: true });

  readonly canManageAccess = computed(() => {
    const role = this.authService.getCurrentUser()?.role;
    return role === 'Admin' || role === 'Manager';
  });

  readonly selectedRole = computed(() =>
    this.roles().find((r) => r._id === this.selectedRoleId()) ?? null
  );

  readonly selectedPermissionKeys = computed(() =>
    this.permissionGroups()
      .flatMap((g) => g.permissions)
      .filter((p) => p.assigned)
      .map((p) => p.key)
  );

  // ─── Permission matrix definition ────────────────────────────────────────
  private readonly ROW_DEFINITIONS: RowDefinition[] = [
    {
      key: 'create_shipment',
      label: 'Create Shipment',
      screenKey: 'create_shipment',
    },
    {
      key: 'shipment_entry',
      label: 'Shipment Entry',
      tabKey: 'shipment_entry',
      hiddenPermissionKeys: ['shipment.field.shipment_entry.piNo.edit'],
    },
    {
      key: 'shipment_tracker_split',
      label: 'Shipment Tracker Split',
      tabKey: 'shipment_tracker_split',
    },
    {
      key: 'bl_details',
      label: 'BL Details',
      tabKey: 'bl_details',
      children: [
        {
          key: 'clearing_advance',
          label: 'Clearing Advance',
          tabKey: 'bl_details',
          viewPermissionKey: 'shipment.tab.bl_details.view',
          editPermissionKey: 'shipment.tab.bl_details.edit',
        },
        {
          key: 'storage_allocations_bl',
          label: 'Storage Allocations',
          tabKey: 'bl_details',
          viewPermissionKey: 'shipment.tab.bl_details.view',
          editPermissionKey: 'shipment.tab.bl_details.edit',
        },
        {
          key: 'packaging_list',
          label: 'Packaging List',
          tabKey: 'bl_details',
          viewPermissionKey: 'shipment.tab.bl_details.view',
          editPermissionKey: 'shipment.tab.bl_details.edit',
        },
        {
          key: 'payment_allocation',
          label: 'Payment Allocation',
          tabKey: 'payment_costing',
          viewPermissionKey: 'shipment.tab.payment_costing.payment_allocation.view',
          editPermissionKey: 'shipment.tab.payment_costing.payment_allocation.edit',
          viewActionKey: 'payment_allocation_view',
          editActionKey: 'payment_allocation_edit',
        },
        {
          key: 'costing_table',
          label: 'Payment Costing Table',
          tabKey: 'payment_costing',
          viewPermissionKey: 'shipment.tab.payment_costing.costing_table.view',
          editPermissionKey: 'shipment.tab.payment_costing.costing_table.edit',
          viewActionKey: 'costing_table_view',
          editActionKey: 'costing_table_edit',
        },
      ],
    },
    {
      key: 'document_tracker',
      label: 'Document Tracker',
      tabKey: 'document_tracker',
    },
    {
      key: 'port_customs',
      label: 'Port & Customs',
      tabKey: 'port_customs',
    },
    {
      key: 'storage',
      label: 'Storage',
      tabKey: 'storage',
      children: [
        {
          key: 'storage_allocation',
          label: 'Storage Allocation',
          tabKey: 'storage',
          viewActionKey: 'storage_allocation_view',
          editActionKey: 'storage_allocation_edit',
        },
        {
          key: 'storage_arrival',
          label: 'Storage Arrival',
          tabKey: 'storage',
          viewActionKey: 'storage_arrival_view',
          editActionKey: 'storage_arrival_edit',
        },
      ],
    },
    {
      key: 'quality',
      label: 'Quality',
      tabKey: 'quality',
    },
  ];

  /** Build a PermissionMatrixRow from a RowDefinition + flat permission list */
  private buildRow(def: RowDefinition, allPermissions: AccessPermission[]): PermissionMatrixRow {
    // Permissions that belong to this row's scope
    const scopedPermissions = allPermissions.filter((p) => {
      if (def.tabKey) return p.tab === def.tabKey;
      if (def.screenKey) return p.screen === def.screenKey && !p.tab;
      return false;
    });

    // View permission: explicit action key OR key ending in '.view' with type tab/screen
    const viewPermission = def.viewPermissionKey
      ? (allPermissions.find((p) => p.key === def.viewPermissionKey) ?? null)
      : def.viewActionKey
      ? (scopedPermissions.find((p) => p.action === def.viewActionKey) ?? null)
      : (scopedPermissions.find((p) => p.key.endsWith('.view') && (p.type === 'tab' || p.type === 'screen')) ?? null);

    // Edit permission: explicit action key OR key ending in '.edit' with type action (not field)
    const editPermission = def.editPermissionKey
      ? (allPermissions.find((p) => p.key === def.editPermissionKey) ?? null)
      : def.editActionKey
      ? (scopedPermissions.find((p) => p.action === def.editActionKey) ?? null)
      : (scopedPermissions.find((p) => p.key.endsWith('.edit') && p.type === 'action') ?? null);

    // Field permissions
    const hiddenPermissionKeys = new Set(def.hiddenPermissionKeys ?? []);
    const fieldPermissions = def.viewActionKey
      ? [] // sub-tab rows don't have their own field permissions
      : scopedPermissions.filter((p) => p.type === 'field' && !hiddenPermissionKeys.has(p.key));

    // Action permissions — everything that is type=action but NOT the view/edit we already captured
    const capturedKeys = new Set<string>();
    if (viewPermission) capturedKeys.add(viewPermission.key);
    if (editPermission) capturedKeys.add(editPermission.key);

    const actionPermissions = def.viewActionKey
      ? []
      : scopedPermissions.filter(
          (p) => p.type === 'action' && !capturedKeys.has(p.key) && !hiddenPermissionKeys.has(p.key)
        );

    // Recurse for children
    const children = def.children?.map((child) => this.buildRow(child, allPermissions));

    return {
      key: def.key,
      label: def.label,
      viewPermission,
      editPermission,
      fieldPermissions,
      actionPermissions,
      children,
    };
  }

  readonly permissionMatrixRows = computed<PermissionMatrixRow[]>(() => {
    const allPermissions = this.permissionGroups().flatMap((g) => g.permissions);
    return this.ROW_DEFINITIONS.map((def) => this.buildRow(def, allPermissions));
  });

  readonly menuPermissionGroups = computed(() =>
    this.permissionGroups().filter((g) =>
      g.permissions.some((p) => p.resource === 'menu')
    )
  );

  readonly selectedUser = computed(() =>
    this.users().find((u) => u._id === this.selectedUserId()) ?? null
  );

  constructor() {
    this.loadRoles();
  }

  // ─── Tab navigation ───────────────────────────────────────────────────────

  setActiveTab(tab: AccessTabKey): void {
    this.activeTab.set(tab);
    this.error.set(null);
    this.success.set(null);
    if (tab === 'users' && !this.users().length && !this.usersLoading()) {
      this.loadUsers();
    }
  }

  // ─── Expand / collapse matrix rows ───────────────────────────────────────

  toggleExpandedRow(rowKey: string): void {
    this.expandedRowKeys.update((keys) => {
      const next = new Set(keys);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  }

  isRowExpanded(rowKey: string): boolean {
    return this.expandedRowKeys().has(rowKey);
  }

  // ─── Roles ────────────────────────────────────────────────────────────────

  loadRoles(): void {
    this.rolesLoading.set(true);
    this.error.set(null);
    this.accessControlService
      .getRoles()
      .pipe(finalize(() => this.rolesLoading.set(false)))
      .subscribe({
        next: ({ roles }) => {
          this.roles.set(roles);
          if (!this.userForm().role && roles.length) {
            this.resetUserForm(roles[0].key);
          }
          const currentSelected = this.selectedRoleId();
          const fallback = roles[0]?._id ?? null;
          const nextId = roles.some((r) => r._id === currentSelected) ? currentSelected : fallback;
          this.selectedRoleId.set(nextId);
          if (nextId) {
            this.loadRolePermissions(nextId);
          } else {
            this.permissionGroups.set([]);
          }
        },
        error: (err) => {
          this.error.set(err.error?.message || 'Unable to load roles right now.');
        },
      });
  }

  selectRole(roleId: string): void {
    this.selectedRoleId.set(roleId);
    this.loadRolePermissions(roleId);
  }

  startCreateRole(): void {
    this.editingRoleId.set(null);
    this.roleForm.set({ key: '', name: '', description: '', isActive: true });
    this.activeTab.set('roles');
  }

  editRole(role: AccessRole): void {
    this.editingRoleId.set(role._id);
    this.roleForm.set({ key: role.key, name: role.name, description: role.description || '', isActive: role.isActive });
    this.activeTab.set('roles');
  }

  saveRole(): void {
    const form = this.roleForm();
    if (!form.key.trim() || !form.name.trim()) {
      this.error.set('Role key and role name are required.');
      return;
    }
    this.saveLoading.set(true);
    this.error.set(null);
    this.success.set(null);

    const request$ = this.editingRoleId()
      ? this.accessControlService.updateRole(this.editingRoleId()!, {
          name: form.name.trim(),
          description: form.description.trim(),
          isActive: form.isActive,
        })
      : this.accessControlService.createRole({
          key: form.key.trim(),
          name: form.name.trim(),
          description: form.description.trim(),
          isActive: form.isActive,
        });

    request$.pipe(finalize(() => this.saveLoading.set(false))).subscribe({
      next: ({ message }) => {
        this.success.set(message);
        this.startCreateRole();
        this.loadRoles();
      },
      error: (err) => {
        this.error.set(err.error?.message || 'Unable to save role right now.');
      },
    });
  }

  // ─── Permissions ──────────────────────────────────────────────────────────

  loadRolePermissions(roleId: string): void {
    this.permissionsLoading.set(true);
    this.error.set(null);
    this.accessControlService
      .getRolePermissions(roleId)
      .pipe(finalize(() => this.permissionsLoading.set(false)))
      .subscribe({
        next: ({ permissionGroups }) => {
          this.permissionGroups.set(permissionGroups);
        },
        error: (err) => {
          this.permissionGroups.set([]);
          this.error.set(err.error?.message || 'Unable to load permissions.');
        },
      });
  }

  /**
   * Toggle a single permission on/off.
   * We search all groups for the permission key rather than relying on a
   * potentially mismatched groupKey.
   */
  togglePermission(permissionKey: string, checked: boolean): void {
    this.permissionGroups.update((groups) =>
      groups.map((group) => ({
        ...group,
        permissions: group.permissions.map((p) =>
          p.key === permissionKey ? { ...p, assigned: checked } : p
        ),
      }))
    );
  }

  savePermissions(): void {
    const roleId = this.selectedRoleId();
    if (!roleId) {
      this.error.set('Select a role first.');
      return;
    }
    this.saveLoading.set(true);
    this.error.set(null);
    this.success.set(null);

    this.accessControlService
      .updateRolePermissions(roleId, this.selectedPermissionKeys())
      .pipe(finalize(() => this.saveLoading.set(false)))
      .subscribe({
        next: ({ message, permissionGroups }) => {
          this.permissionGroups.set(permissionGroups);
          this.success.set(message);
        },
        error: (err) => {
          this.error.set(err.error?.message || 'Unable to save permissions.');
        },
      });
  }

  // ─── Users ────────────────────────────────────────────────────────────────

  loadUsers(): void {
    this.usersLoading.set(true);
    this.error.set(null);
    this.accessControlService
      .getUsers()
      .pipe(finalize(() => this.usersLoading.set(false)))
      .subscribe({
        next: ({ users, roles }) => {
          this.users.set(users);
          if (!this.roles().length && roles.length) this.roles.set(roles);
          if (!this.userForm().role && roles.length) this.resetUserForm(roles[0].key);
          const currentSelected = this.selectedUserId();
          const fallback = users[0]?._id ?? null;
          const nextId = users.some((u) => u._id === currentSelected) ? currentSelected : fallback;
          this.selectedUserId.set(nextId);
          if (nextId) this.selectUser(nextId);
        },
        error: (err) => {
          this.error.set(err.error?.message || 'Unable to load users right now.');
        },
      });
  }

  selectUser(userId: string): void {
    this.selectedUserId.set(userId);
    const user = this.users().find((u) => u._id === userId);
    if (!user) return;
    this.userForm.set({ email: user.email, name: user.name, role: user.role, isActive: user.isActive });
  }

  startCreateUser(): void {
    this.selectedUserId.set(null);
    this.resetUserForm(this.roles()[0]?.key || '');
  }

  private resetUserForm(defaultRole: string): void {
    this.userForm.set({ email: '', name: '', role: defaultRole, isActive: true });
  }

  saveUser(): void {
    const userId = this.selectedUserId();
    if (!userId) { this.error.set('Select a user first.'); return; }
    const form = this.userForm();
    if (!form.name.trim() || !form.role.trim()) { this.error.set('User name and role are required.'); return; }

    this.saveLoading.set(true);
    this.error.set(null);
    this.success.set(null);

    this.accessControlService
      .updateUser(userId, { name: form.name.trim(), role: form.role.trim(), isActive: form.isActive })
      .pipe(finalize(() => this.saveLoading.set(false)))
      .subscribe({
        next: ({ message, user }) => {
          this.users.update((users) => users.map((u) => (u._id === user._id ? user : u)));
          this.selectUser(user._id);
          this.success.set(message);
        },
        error: (err) => {
          this.error.set(err.error?.message || 'Unable to update user.');
        },
      });
  }

  createUser(): void {
    const form = this.userForm();
    if (!form.name.trim() || !form.email.trim() || !form.role.trim()) {
      this.error.set('Name, email, and role are required to create a user.');
      return;
    }
    this.saveLoading.set(true);
    this.error.set(null);
    this.success.set(null);

    this.accessControlService
      .createUser({ name: form.name.trim(), email: form.email.trim(), role: form.role.trim(), isActive: form.isActive })
      .pipe(finalize(() => this.saveLoading.set(false)))
      .subscribe({
        next: ({ message, user }) => {
          this.users.update((users) => [user, ...users]);
          this.startCreateUser();
          this.selectUser(user._id);
          this.success.set(message);
        },
        error: (err) => {
          this.error.set(err.error?.message || 'Unable to create user.');
        },
      });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  groupAssignedCount(group: AccessPermissionGroup): number {
    return group.permissions.filter((p) => p.assigned).length;
  }

  trackByRole(_: number, role: AccessRole): string { return role._id; }
  trackByGroup(_: number, group: AccessPermissionGroup): string { return group.key; }
  trackByPermission(_: number, permission: AccessPermission): string { return permission.key; }
  trackByUser(_: number, user: AccessUser): string { return user._id; }
  trackByRow(_: number, row: PermissionMatrixRow): string { return row.key; }
}
