import { Component, Input, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormGroup, ReactiveFormsModule, AbstractControl } from '@angular/forms';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { selectShipmentData } from '../../../../../../store/shipment/shipment.selectors';
import { AccordionModule } from 'primeng/accordion';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { SelectModule } from 'primeng/select';

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
  readonly shipmentData = toSignal(this.store.select(selectShipmentData));

  // Tab state uses compound key "shipmentIndex-containerIndex"
  readonly activeTabs = signal<Record<string, 'allocation' | 'arrival'>>({});
  readonly expandedContainers = signal<Record<number, boolean>>({});

  readonly warehouseOptions = [
    { label: 'Main Warehouse', value: 'Main Warehouse' },
    { label: 'Secondary Warehouse', value: 'Secondary Warehouse' },
    { label: 'Transit Warehouse', value: 'Transit Warehouse' },
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
}
