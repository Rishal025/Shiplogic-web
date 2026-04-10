import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageService, ConfirmationService } from 'primeng/api';
import { WarehouseService, Warehouse } from '../../../core/services/warehouse.service';

@Component({
  selector: 'app-warehouse-management',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    TableModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    ToastModule,
    ConfirmDialogModule,
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <div class="p-6">
      <div class="flex justify-between items-center mb-6">
        <div>
          <h1 class="text-2xl font-bold text-slate-800">Warehouse Management</h1>
          <p class="text-slate-500">Create, edit and manage storage locations</p>
        </div>
        <button 
          pButton 
          label="Add Warehouse" 
          icon="pi pi-plus" 
          class="p-button-primary shadow-sm"
          (click)="openAddDialog()">
        </button>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <p-table 
          [value]="warehouses()" 
          [loading]="loading()"
          responsiveLayout="scroll"
          styleClass="p-datatable-sm"
          [rows]="10"
          [paginator]="true">
          <ng-template pTemplate="header">
            <tr>
              <th class="bg-slate-50 text-slate-600 font-semibold py-4">Name</th>
              <th class="bg-slate-50 text-slate-600 font-semibold py-4">Code</th>
              <th class="bg-slate-50 text-slate-600 font-semibold py-4">Location</th>
              <th class="bg-slate-50 text-slate-600 font-semibold py-4">Manager</th>
              <th class="bg-slate-50 text-slate-600 font-semibold py-4 text-center">Status</th>
              <th class="bg-slate-50 text-slate-600 font-semibold py-4 text-right px-6">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-warehouse>
            <tr class="hover:bg-slate-50/50 transition-colors border-b border-slate-100 last:border-0">
              <td class="py-4 font-medium text-slate-700">{{ warehouse.name }}</td>
              <td class="py-4 text-slate-500 font-mono text-sm">{{ warehouse.code || '–' }}</td>
              <td class="py-4 text-slate-500">{{ warehouse.location || '–' }}</td>
              <td class="py-4 text-slate-500">{{ warehouse.managerName || '–' }}</td>
              <td class="py-4 text-center">
                <span 
                  [class]="warehouse.status === 'Active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-100 text-slate-600 border-slate-200'"
                  class="px-2.5 py-1 rounded-full text-xs font-medium border">
                  {{ warehouse.status }}
                </span>
              </td>
              <td class="py-4 text-right px-6">
                <div class="flex justify-end gap-2">
                  <button 
                    pButton 
                    icon="pi pi-pencil" 
                    class="p-button-text p-button-sm p-button-info"
                    (click)="openEditDialog(warehouse)">
                  </button>
                  <button 
                    pButton 
                    icon="pi pi-trash" 
                    class="p-button-text p-button-sm p-button-danger"
                    (click)="confirmDelete(warehouse)">
                  </button>
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="6" class="p-12 text-center text-slate-400">
                <i class="pi pi-box text-4xl mb-3 block opacity-20"></i>
                No warehouses found. Click "Add Warehouse" to create one.
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    </div>

    <!-- Add/Edit Dialog -->
    <p-dialog 
      [(visible)]="displayDialog" 
      [header]="editingWarehouse() ? 'Edit Warehouse' : 'Add New Warehouse'" 
      [modal]="true" 
      [style]="{width: '450px'}" 
      class="p-fluid">
      <form [formGroup]="warehouseForm" (ngSubmit)="saveWarehouse()" class="flex flex-col gap-4 pt-4">
        <div class="field">
          <label for="name" class="block text-sm font-semibold text-slate-700 mb-1">Warehouse Name *</label>
          <input pInputText id="name" formControlName="name" placeholder="e.g. Dubai Central Hub" />
        </div>
        
        <div class="field">
          <label for="code" class="block text-sm font-semibold text-slate-700 mb-1">Warehouse Code</label>
          <input pInputText id="code" formControlName="code" placeholder="e.g. DXB-01" />
        </div>

        <div class="field">
          <label for="location" class="block text-sm font-semibold text-slate-700 mb-1">Location</label>
          <input pInputText id="location" formControlName="location" placeholder="e.g. Al Quoz, Dubai" />
        </div>

        <div class="flex gap-4">
          <div class="field flex-1">
            <label for="managerName" class="block text-sm font-semibold text-slate-700 mb-1">Manager Name</label>
            <input pInputText id="managerName" formControlName="managerName" />
          </div>
          <div class="field flex-1">
            <label for="capacity" class="block text-sm font-semibold text-slate-700 mb-1">Capacity (MT)</label>
            <p-inputNumber id="capacity" formControlName="capacity"></p-inputNumber>
          </div>
        </div>

        <div class="field">
          <label for="status" class="block text-sm font-semibold text-slate-700 mb-1">Status</label>
          <p-select 
            id="status" 
            [options]="statusOptions" 
            formControlName="status" 
            placeholder="Select Status">
          </p-select>
        </div>

        <div class="flex justify-end gap-3 mt-6">
          <button 
            type="button" 
            pButton 
            label="Cancel" 
            class="p-button-text p-button-secondary" 
            (click)="displayDialog = false">
          </button>
          <button 
            type="submit" 
            pButton 
            [label]="editingWarehouse() ? 'Update' : 'Save'" 
            class="p-button-primary shadow-sm"
            [disabled]="warehouseForm.invalid || saving()">
          </button>
        </div>
      </form>
    </p-dialog>

    <p-confirmDialog header="Delete Warehouse" icon="pi pi-exclamation-triangle"></p-confirmDialog>
    <p-toast></p-toast>
  `,
  styles: [`
    :host ::ng-deep .p-datatable .p-datatable-thead > tr > th {
      border-bottom: 2px solid #f1f5f9;
    }
  `]
})
export class WarehouseManagementComponent implements OnInit {
  private warehouseService = inject(WarehouseService);
  private fb = inject(FormBuilder);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);

  warehouses = signal<Warehouse[]>([]);
  loading = signal(false);
  saving = signal(false);
  displayDialog = false;
  editingWarehouse = signal<Warehouse | null>(null);

  warehouseForm: FormGroup = this.fb.group({
    name: ['', Validators.required],
    code: [''],
    location: [''],
    managerName: [''],
    capacity: [null],
    status: ['Active', Validators.required]
  });

  statusOptions = [
    { label: 'Active', value: 'Active' },
    { label: 'Inactive', value: 'Inactive' }
  ];

  ngOnInit() {
    this.loadWarehouses();
  }

  loadWarehouses() {
    this.loading.set(true);
    this.warehouseService.getWarehouses().subscribe({
      next: (data: Warehouse[]) => {
        this.warehouses.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not load warehouses' });
        this.loading.set(false);
      }
    });
  }

  openAddDialog() {
    this.editingWarehouse.set(null);
    this.warehouseForm.reset({ status: 'Active' });
    this.displayDialog = true;
  }

  openEditDialog(warehouse: Warehouse) {
    this.editingWarehouse.set(warehouse);
    this.warehouseForm.patchValue(warehouse);
    this.displayDialog = true;
  }

  saveWarehouse() {
    if (this.warehouseForm.invalid) return;
    
    this.saving.set(true);
    const data = this.warehouseForm.value;
    const editing = this.editingWarehouse();

    if (editing?._id) {
      this.warehouseService.updateWarehouse(editing._id, data).subscribe({
        next: (res: Warehouse) => {
          this.messageService.add({ severity: 'success', summary: 'Updated', detail: 'Warehouse updated successfully' });
          this.loadWarehouses();
          this.displayDialog = false;
          this.saving.set(false);
        },
        error: (err: any) => {
          this.messageService.add({ severity: 'error', summary: 'Update failed', detail: err.error?.message || 'Error occurred' });
          this.saving.set(false);
        }
      });
    } else {
      this.warehouseService.createWarehouse(data).subscribe({
        next: (res: Warehouse) => {
          this.messageService.add({ severity: 'success', summary: 'Created', detail: 'New warehouse added' });
          this.loadWarehouses();
          this.displayDialog = false;
          this.saving.set(false);
        },
        error: (err: any) => {
          this.messageService.add({ severity: 'error', summary: 'Creation failed', detail: err.error?.message || 'Error occurred' });
          this.saving.set(false);
        }
      });
    }
  }

  confirmDelete(warehouse: Warehouse) {
    this.confirmationService.confirm({
      message: `Are you sure you want to delete ${warehouse.name}?`,
      accept: () => {
        if (!warehouse._id) return;
        this.warehouseService.deleteWarehouse(warehouse._id).subscribe({
          next: () => {
            this.messageService.add({ severity: 'success', summary: 'Deleted', detail: 'Warehouse removed' });
            this.loadWarehouses();
          },
          error: () => {
            this.messageService.add({ severity: 'error', summary: 'Delete failed', detail: 'Could not delete warehouse' });
          }
        });
      }
    });
  }
}
