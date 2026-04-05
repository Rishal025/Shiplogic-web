import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AccessPermission, AccessPermissionGroup, AccessRole, AccessUser, EffectivePermissionsResponse } from '../models/access-control.model';

@Injectable({
  providedIn: 'root',
})
export class AccessControlService {
  private apiUrl = 'access-control';

  constructor(private http: HttpClient) {}

  getRoles(): Observable<{ roles: AccessRole[] }> {
    return this.http.get<{ roles: AccessRole[] }>(`${this.apiUrl}/roles`);
  }

  createRole(payload: Partial<AccessRole> & { key: string; name: string }): Observable<{ message: string; role: AccessRole }> {
    return this.http.post<{ message: string; role: AccessRole }>(`${this.apiUrl}/roles`, payload);
  }

  createUser(payload: Partial<AccessUser> & { name: string; email: string; role: string }): Observable<{ message: string; user: AccessUser }> {
    return this.http.post<{ message: string; user: AccessUser }>(`${this.apiUrl}/users`, payload);
  }

  updateRole(roleId: string, payload: Partial<AccessRole>): Observable<{ message: string; role: AccessRole }> {
    return this.http.patch<{ message: string; role: AccessRole }>(`${this.apiUrl}/roles/${roleId}`, payload);
  }

  getPermissions(resource = 'shipment'): Observable<{ permissions: AccessPermission[] }> {
    return this.http.get<{ permissions: AccessPermission[] }>(`${this.apiUrl}/permissions`, {
      params: { resource },
    });
  }

  getRolePermissions(roleId: string): Observable<{ role: AccessRole; permissionGroups: AccessPermissionGroup[] }> {
    return this.http.get<{ role: AccessRole; permissionGroups: AccessPermissionGroup[] }>(
      `${this.apiUrl}/roles/${roleId}/permissions`
    );
  }

  updateRolePermissions(roleId: string, permissionKeys: string[]): Observable<{ message: string; role: AccessRole; permissionGroups: AccessPermissionGroup[] }> {
    return this.http.put<{ message: string; role: AccessRole; permissionGroups: AccessPermissionGroup[] }>(
      `${this.apiUrl}/roles/${roleId}/permissions`,
      { permissionKeys }
    );
  }

  getEffectivePermissions(): Observable<EffectivePermissionsResponse> {
    return this.http.get<EffectivePermissionsResponse>(`${this.apiUrl}/effective-permissions`);
  }

  getUsers(): Observable<{ users: AccessUser[]; roles: AccessRole[] }> {
    return this.http.get<{ users: AccessUser[]; roles: AccessRole[] }>(`${this.apiUrl}/users`);
  }

  updateUser(userId: string, payload: Partial<AccessUser>): Observable<{ message: string; user: AccessUser }> {
    return this.http.patch<{ message: string; user: AccessUser }>(`${this.apiUrl}/users/${userId}`, payload);
  }
}
