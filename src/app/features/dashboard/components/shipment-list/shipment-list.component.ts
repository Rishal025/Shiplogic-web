import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SkeletonModule } from 'primeng/skeleton';

import { PrimaryButtonDirective } from '../../../../shared/directives/button.directive';
import { ShipmentService } from '../../../../core/services/shipment.service';
import { Shipment } from '../../../../core/models/shipment.model';
import { RbacService } from '../../../../core/services/rbac.service';

@Component({
    selector: 'app-shipment-list',
    standalone: true,
    imports: [
        CommonModule, 
        PrimaryButtonDirective, 
        RouterLink,
        SkeletonModule
    ],
    templateUrl: './shipment-list.component.html',
    styleUrls: ['./shipment-list.component.scss']
})
export class ShipmentListComponent implements OnInit {
    private shipmentService = inject(ShipmentService);
    private rbacService = inject(RbacService);
    protected readonly Math = Math;

    // Use signals for better zoneless change detection
    shipments = signal<Shipment[]>([]);
    loading = signal(true);
    currentPage = signal(1);
    pageSize = signal(20);
    totalRecords = signal(0);
    totalPages = signal(0);
    readonly canCreateShipment = computed(() =>
        this.rbacService.hasPermission('shipment.screen.create_shipment.view')
    );

    ngOnInit() {
        this.fetchShipments();
    }

    fetchShipments() {
        this.loading.set(true);
        
        this.shipmentService.getShipments(this.currentPage(), this.pageSize()).subscribe({
            next: (response) => {
                this.shipments.set(response.shipments);
                this.totalRecords.set(response.totalRecords);
                this.totalPages.set(response.totalPages);
                this.currentPage.set(response.page);
                this.loading.set(false);
            },
            error: (error) => {
                console.error('Error fetching shipments:', error);
                this.loading.set(false);
            }
        });
    }

    onPageChange(page: number) {
        if (page >= 1 && page <= this.totalPages()) {
            this.currentPage.set(page);
            this.fetchShipments();
        }
    }

    getSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
        if (!status) return 'secondary';
        const s = status.toLowerCase();
        if (s.includes('completed') || s === 'payment costing') return 'success';
        if (s.includes('quality')) return 'success';
        if (s.includes('storage')) return 'info';
        if (s.includes('port') || s.includes('customs')) return 'warn';
        if (s.includes('documentation')) return 'warn';
        if (s.includes('b/l') || s.includes('bl ')) return 'warn';
        if (s.includes('split')) return 'info';
        if (s.includes('entry')) return 'secondary';
        if (s.includes('delayed') || s.includes('error')) return 'danger';
        return 'secondary';
    }
}
