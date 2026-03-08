import { Routes } from '@angular/router';
import { MainLayoutComponent } from './layouts/main-layout/main-layout.component';
import { AuthLayoutComponent } from './layouts/auth-layout/auth-layout.component';
import { NotFoundComponent } from './features/not-found/not-found.component';
import { ForbiddenComponent } from './shared/components/forbidden/forbidden.component';

export const routes: Routes = [
    {
        path: 'auth',
        component: AuthLayoutComponent,
        children: [
            { path: '', loadChildren: () => import('./features/auth/auth.routes').then(m => m.AUTH_ROUTES) }
        ]
    },
    {
        path: '',
        component: MainLayoutComponent,
        children: [
            { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
            { path: 'dashboard', loadChildren: () => import('./features/dashboard/dashboard.routes').then(m => m.DASHBOARD_ROUTES) },
            { path: 'shipments', loadChildren: () => import('./features/shipment/shipment.routes').then(m => m.SHIPMENT_ROUTES) }

        ]
    },
    { path: 'forbidden', component: ForbiddenComponent },
    { path: '**', component: NotFoundComponent }
];
