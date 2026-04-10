import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { AccessControlService } from '../../../../core/services/access-control.service';
import { AccessPermission, AccessPermissionGroup, AccessRole, AccessUser } from '../../../../core/models/access-control.model';
import { AuthService } from '../../../../core/services/auth.service';

type AccessTabKey = 'roles' | 'menu' | 'permissions' | 'users';
interface FlattenedPermissionRow {
  groupKey: string;
  groupLabel: string;
  permission: AccessPermission;
}
interface PermissionMatrixRow {
  key: string;
  label: string;
  viewPermission: AccessPermission | null;
  editPermission: AccessPermission | null;
  fieldPermissions: AccessPermission[];
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
  readonly expandedPermissionRowKey = signal<string | null>(null);

  readonly roleForm = signal({
    key: '',
    name: '',
    description: '',
    isActive: true,
  });
  readonly editingRoleId = signal<string | null>(null);
  readonly userForm = signal({
    email: '',
    name: '',
    role: '',
    isActive: true,
  });

  readonly canManageAccess = computed(() => {
    const role = this.authService.getCurrentUser()?.role;
    return role === 'Admin' || role === 'Manager';
  });

  readonly selectedRole = computed(() => this.roles().find((role) => role._id === this.selectedRoleId()) || null);
  readonly selectedPermissionKeys = computed(() =>
    this.permissionGroups()
      .flatMap((group) => group.permissions)
      .filter((permission) => permission.assigned)
      .map((permission) => permission.key)
  );

  readonly tabPermissionGroups = computed(() =>
    this.permissionGroups().filter((group) =>
      group.permissions.some((permission) =>
        permission.resource === 'shipment' &&
        (permission.type === 'tab' || permission.type === 'screen' || permission.type === 'action')
      )
    )
  );

  readonly fieldPermissionGroups = computed(() =>
    this.permissionGroups().filter((group) =>
      group.permissions.some((permission) => permission.resource === 'shipment' && permission.type === 'field')
    )
  );

  readonly permissionMatrixRows = computed<PermissionMatrixRow[]>(() => {
    const rowDefinitions = [
      { key: 'create_shipment', label: 'Create Shipment', groupKey: 'create_shipment' },
      { key: 'shipment_entry', label: 'Shipment Entry', groupKey: 'shipment_entry' },
      { key: 'shipment_tracker_split', label: 'Shipment Tracker', groupKey: 'shipment_tracker_split' },
      { key: 'bl_details', label: 'BL Details', groupKey: 'bl_details' },
      { key: 'document_tracker', label: 'Document Tracker', groupKey: 'document_tracker' },
      { key: 'port_customs', label: 'Port & Customs', groupKey: 'port_customs' },
      { key: 'storage_arrival', label: 'Storage Allocation & Arrival', groupKey: 'storage_arrival' },
      { key: 'quality', label: 'Quality', groupKey: 'quality' },
      { key: 'payment_costing', label: 'Payment & Costing', groupKey: 'payment_costing' },
    ] as const;

    const allPermissions = this.permissionGroups().flatMap((group) => group.permissions);

    return rowDefinitions.map((row) => {
      const permissionsForRow = allPermissions.filter((permission) => {
        if (row.key === 'create_shipment') {
          return permission.screen === 'create_shipment';
        }
        return permission.tab === row.key;
      });

      const viewPermission =
        permissionsForRow.find((permission) => permission.key.endsWith('.view')) ?? null;

      const editPermission =
        permissionsForRow.find((permission) => permission.key.endsWith('.edit') && permission.type !== 'field') ?? null;

      const fieldPermissions = permissionsForRow.filter((permission) => permission.type === 'field');

      return {
        key: row.key,
        label: row.label,
        viewPermission,
        editPermission,
        fieldPermissions,
      };
    });
  });

  readonly tabPermissionRows = computed<FlattenedPermissionRow[]>(() =>
    this.tabPermissionGroups().flatMap((group) =>
      group.permissions.map((permission) => ({
        groupKey: group.key,
        groupLabel: group.label,
        permission,
      }))
    )
  );

  readonly menuPermissionGroups = computed(() =>
    this.permissionGroups().filter((group) =>
      group.permissions.some((permission) => permission.resource === 'menu')
    )
  );

  readonly selectedUser = computed(() => this.users().find((user) => user._id === this.selectedUserId()) || null);

  constructor() {
    this.loadRoles();
  }

  setActiveTab(tab: AccessTabKey): void {
    this.activeTab.set(tab);
    this.error.set(null);
    this.success.set(null);
    if (tab === 'users' && !this.users().length && !this.usersLoading()) {
      this.loadUsers();
    }
  }

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
          const fallbackRole = roles[0]?._id ?? null;
          const nextRoleId = roles.some((role) => role._id === currentSelected) ? currentSelected : fallbackRole;
          this.selectedRoleId.set(nextRoleId);
          if (nextRoleId) {
            this.loadRolePermissions(nextRoleId);
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

  loadUsers(): void {
    this.usersLoading.set(true);
    this.error.set(null);
    this.accessControlService
      .getUsers()
      .pipe(finalize(() => this.usersLoading.set(false)))
      .subscribe({
        next: ({ users, roles }) => {
          this.users.set(users);
          if (!this.roles().length && roles.length) {
            this.roles.set(roles);
          }
          if (!this.userForm().role && roles.length) {
            this.resetUserForm(roles[0].key);
          }
          const currentSelected = this.selectedUserId();
          const fallbackUser = users[0]?._id ?? null;
          const nextUserId = users.some((user) => user._id === currentSelected) ? currentSelected : fallbackUser;
          this.selectedUserId.set(nextUserId);
          if (nextUserId) {
            this.selectUser(nextUserId);
          }
        },
        error: (err) => {
          this.error.set(err.error?.message || 'Unable to load users right now.');
        },
      });
  }

  selectUser(userId: string): void {
    this.selectedUserId.set(userId);
    const user = this.users().find((entry) => entry._id === userId);
    if (!user) return;

    this.userForm.set({
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
    });
  }

  startCreateUser(): void {
    this.selectedUserId.set(null);
    this.resetUserForm(this.roles()[0]?.key || '');
  }

  private resetUserForm(defaultRole: string): void {
    this.userForm.set({
      email: '',
      name: '',
      role: defaultRole,
      isActive: true,
    });
  }

  startCreateRole(): void {
    this.editingRoleId.set(null);
    this.roleForm.set({ key: '', name: '', description: '', isActive: true });
    this.activeTab.set('roles');
  }

  editRole(role: AccessRole): void {
    this.editingRoleId.set(role._id);
      this.roleForm.set({
        key: role.key,
        name: role.name,
        description: role.description || '',
        isActive: role.isActive,
      });
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

    request$
      .pipe(finalize(() => this.saveLoading.set(false)))
      .subscribe({
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
          this.error.set(err.error?.message || 'Unable to load tab permissions.');
        },
      });
  }

  togglePermission(groupKey: string, permissionKey: string, checked: boolean): void {
    this.permissionGroups.update((groups) =>
      groups.map((group) =>
        group.key !== groupKey
          ? group
          : {
              ...group,
              permissions: group.permissions.map((permission) =>
                permission.key === permissionKey ? { ...permission, assigned: checked } : permission
              ),
            }
      )
    );
  }

  toggleExpandedPermissionRow(rowKey: string): void {
    this.expandedPermissionRowKey.update((current) => (current === rowKey ? null : rowKey));
  }

  isPermissionRowExpanded(rowKey: string): boolean {
    return this.expandedPermissionRowKey() === rowKey;
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

  saveUser(): void {
    const userId = this.selectedUserId();
    if (!userId) {
      this.error.set('Select a user first.');
      return;
    }

    const form = this.userForm();
    if (!form.name.trim() || !form.role.trim()) {
      this.error.set('User name and role are required.');
      return;
    }

    this.saveLoading.set(true);
    this.error.set(null);
    this.success.set(null);

    this.accessControlService
      .updateUser(userId, {
        name: form.name.trim(),
        role: form.role.trim(),
        isActive: form.isActive,
      })
      .pipe(finalize(() => this.saveLoading.set(false)))
      .subscribe({
        next: ({ message, user }) => {
          this.users.update((users) => users.map((entry) => (entry._id === user._id ? user : entry)));
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
      .createUser({
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role.trim(),
        isActive: form.isActive,
      })
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

  groupAssignedCount(group: AccessPermissionGroup): number {
    return group.permissions.filter((permission) => permission.assigned).length;
  }

  trackByRole(_: number, role: AccessRole): string {
    return role._id;
  }

  trackByGroup(_: number, group: AccessPermissionGroup): string {
    return group.key;
  }

  trackByPermission(_: number, permission: AccessPermission): string {
    return permission.key;
  }

  trackByUser(_: number, user: AccessUser): string {
    return user._id;
  }
}
