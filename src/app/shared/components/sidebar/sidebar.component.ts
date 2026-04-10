import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { RbacService } from '../../../core/services/rbac.service';

interface SidebarMenuItem {
  label: string;
  icon: string;
  route: string;
  permissionKey?: string;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  @Input() collapsed = false;
  @Output() toggleCollapse = new EventEmitter<void>();

  constructor(private authService: AuthService, private rbacService: RbacService) {}

  get menuItems() {
    const role = this.authService.getCurrentUser()?.role;
    const isAccessManager = role === 'Admin' || role === 'Manager';
    const hasLoadedPermissions = this.rbacService.permissionKeys.length > 0;

    const items: SidebarMenuItem[] = [
      { label: 'Dashboard', icon: 'pi pi-chart-bar', route: '/dashboard', permissionKey: 'menu.dashboard.view' },
      { label: 'Shipments', icon: 'pi pi-truck', route: '/shipments', permissionKey: 'menu.shipments.view' },
      { label: 'Suppliers', icon: 'pi pi-users', route: '/suppliers', permissionKey: 'menu.suppliers.view' },
      { label: 'Reports', icon: 'pi pi-chart-line', route: '/reports', permissionKey: 'menu.reports.view' },
      { label: 'Access Control', icon: 'pi pi-shield', route: '/access-control', permissionKey: 'menu.access_control.view' },
      { label: 'Settings', icon: 'pi pi-cog', route: '/settings/warehouses', permissionKey: 'menu.settings.view' },
    ];

    return items.filter((item) => {
      if (item.route === '/access-control' && !isAccessManager) {
        return false;
      }
      if (!hasLoadedPermissions) {
        return item.route !== '/access-control' || isAccessManager;
      }
      return !item.permissionKey || this.rbacService.hasPermission(item.permissionKey);
    });
  }

  onToggleCollapse(): void {
    this.toggleCollapse.emit();
  }
}
