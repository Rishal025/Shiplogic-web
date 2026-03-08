import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, AbstractControl } from '@angular/forms';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { InputNumberModule } from 'primeng/inputnumber';
import { TagModule } from 'primeng/tag';
import { selectShipmentData, selectIsPlannedLocked } from '../../../../../../store/shipment/shipment.selectors';

@Component({
  selector: 'app-shipment-summary',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputNumberModule, TagModule],
  templateUrl: './shipment-summary.component.html',
})
export class ShipmentSummaryComponent {
  @Input({ required: true }) plannedContainersControl!: AbstractControl;

  private store = inject(Store);

  readonly shipmentData = toSignal(this.store.select(selectShipmentData));
  readonly isPlannedLocked = toSignal(this.store.select(selectIsPlannedLocked), {
    initialValue: false,
  });
}
