import { Routes } from '@angular/router';

export const SETTINGS_ROUTES: Routes = [
  {
    path: 'warehouses',
    loadComponent: () => import('./warehouse-management/warehouse-management.component').then(m => m.WarehouseManagementComponent)
  },
  {
    path: 'item-codes',
    loadComponent: () => import('./item-code-management/item-code-management.component').then(m => m.ItemCodeManagementComponent)
  }
];
