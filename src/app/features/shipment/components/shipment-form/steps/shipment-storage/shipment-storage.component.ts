import { Component, Input, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormGroup, ReactiveFormsModule, AbstractControl } from '@angular/forms';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { selectShipmentData } from '../../../../../../store/shipment/shipment.selectors';
import * as ShipmentActions from '../../../../../../store/shipment/shipment.actions';
import { AccordionModule } from 'primeng/accordion';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { SelectModule } from 'primeng/select';
import { ShipmentService } from '../../../../../../core/services/shipment.service';
import { NotificationService } from '../../../../../../core/services/notification.service';

@Component({
  selector: 'app-shipment-storage',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    AccordionModule,
    DatePickerModule,
    InputNumberModule,
    InputTextModule,
    ToggleSwitch,
    SelectModule,
  ],
  templateUrl: './shipment-storage.component.html',
})
export class ShipmentStorageComponent {
  @Input({ required: true }) formArray!: FormArray;

  private store = inject(Store);
  private shipmentService = inject(ShipmentService);
  private notificationService = inject(NotificationService);
  readonly shipmentData = toSignal(this.store.select(selectShipmentData));

  // Tab state uses compound key "shipmentIndex-containerIndex"
  readonly activeTabs = signal<Record<string, 'allocation' | 'arrival'>>({});
  readonly expandedContainers = signal<Record<number, boolean>>({});
  readonly savingRowIndex = signal<number | null>(null);

  readonly warehouseOptions = [
    { label: 'Warehouse DIC - RH006', value: 'Warehouse DIC - RH006' },
    { label: 'Warehouse Musaffah- RH001P1', value: 'Warehouse Musaffah- RH001P1' },
  ];

  /** Returns the nested containers FormArray for a given shipment group */
  getContainersArray(group: AbstractControl): AbstractControl[] {
    const containers = (group as FormGroup).get('containers') as FormArray;
    return containers ? containers.controls : [];
  }

  getVisibleContainers(group: AbstractControl, shipmentIndex: number): AbstractControl[] {
    const all = this.getContainersArray(group);
    return this.expandedContainers()[shipmentIndex] ? all : all.slice(0, 5);
  }

  hasHiddenContainers(group: AbstractControl): boolean {
    return this.getContainersArray(group).length > 5;
  }

  toggleContainers(shipmentIndex: number): void {
    this.expandedContainers.update((cur) => ({ ...cur, [shipmentIndex]: !cur[shipmentIndex] }));
  }

  getShipmentNoLabel(index: number): string {
    if (this.formArray?.controls[index] == null) return '–';
    const base = this.shipmentData()?.shipment?.shipmentNo;
    return base?.trim() ? `${base}-${index + 1}` : '–';
  }

  setActiveTab(shipmentIndex: number, containerIndex: number, tab: 'allocation' | 'arrival'): void {
    const key = `${shipmentIndex}-${containerIndex}`;
    this.activeTabs.update((current) => ({ ...current, [key]: tab }));
  }

  getActiveTab(shipmentIndex: number, containerIndex: number): 'allocation' | 'arrival' {
    const key = `${shipmentIndex}-${containerIndex}`;
    return this.activeTabs()[key] ?? 'allocation';
  }

  saveRow(index: number): void {
    const group = this.formArray.at(index) as FormGroup | null;
    const shipmentId = this.shipmentData()?.shipment?._id;
    if (!group || !shipmentId) return;

    const containerId = group.get('containerId')?.value;
    if (!containerId) {
      this.notificationService.warn('Missing container', 'This shipment row is not linked to a container yet.');
      return;
    }

    const containers = this.getContainersArray(group).map((control) => {
      const row = control as FormGroup;
      const toDate = (value: unknown) =>
        value ? new Date(value as string | Date).toISOString().split('T')[0] : '';
      return {
        containerSerialNo: row.get('containerSerialNo')?.value || '',
        warehouse: row.get('warehouse')?.value || '',
        storageAvailability: Number(row.get('storageAvailability')?.value) || 0,
        receivedOnDate: toDate(row.get('receivedOnDate')?.value),
        receivedOnTime: row.get('receivedOnTime')?.value || '',
        customsInspection: row.get('customsInspection')?.value || 'No',
        grn: row.get('grn')?.value || '',
        batch: row.get('batch')?.value || '',
        productionDate: toDate(row.get('productionDate')?.value),
        expiryDate: toDate(row.get('expiryDate')?.value),
        remarks: row.get('remarks')?.value || '',
      };
    });

    this.savingRowIndex.set(index);
    this.shipmentService.submitStorageDetails(containerId, { storageSplits: containers }).subscribe({
      next: () => {
        this.savingRowIndex.set(null);
        this.notificationService.success('Saved', 'Storage details saved successfully.');
        this.store.dispatch(ShipmentActions.loadShipmentDetail({ id: shipmentId }));
      },
      error: (error) => {
        this.savingRowIndex.set(null);
        this.notificationService.error('Save failed', error.error?.message || 'Could not save storage details.');
      }
    });
  }
}
