import { Component, Input, Output, EventEmitter, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormArray } from '@angular/forms';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { ConfirmationService } from 'primeng/api';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { DatePickerModule } from 'primeng/datepicker';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import {
  selectActiveSplitTab,
  selectIsPlannedLocked,
  selectShipmentData,
  selectSubmittedActualIndices,
  selectSubmittingPlanned,
  selectSubmittingRowIndex,
} from '../../../../../../store/shipment/shipment.selectors';
import * as ShipmentActions from '../../../../../../store/shipment/shipment.actions';

@Component({
  selector: 'app-shipment-split',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputNumberModule,
    InputTextModule,
    DatePickerModule,
    ButtonModule,
    TableModule,
    ConfirmDialogModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './shipment-split.component.html',
})
export class ShipmentSplitComponent {
  @Input({ required: true }) plannedSplits!: FormArray;
  @Input({ required: true }) actualSplits!: FormArray;
  @Output() addActual = new EventEmitter<void>();
  @Output() removeActual = new EventEmitter<number>();

  private store = inject(Store);
  private confirmationService = inject(ConfirmationService);

  readonly shipmentData = toSignal(this.store.select(selectShipmentData));
  readonly isPlannedLocked = toSignal(this.store.select(selectIsPlannedLocked), {
    initialValue: false,
  });
  readonly activeSplitTab = toSignal(this.store.select(selectActiveSplitTab), {
    initialValue: 'planned' as const,
  });
  readonly submittedActualIndices = toSignal(this.store.select(selectSubmittedActualIndices), {
    initialValue: [],
  });
  readonly submittingPlanned = toSignal(this.store.select(selectSubmittingPlanned), {
    initialValue: false,
  });
  readonly submittingRowIndex = toSignal(this.store.select(selectSubmittingRowIndex), {
    initialValue: null,
  });

  constructor() {
    // Disable submitted actual rows whenever submitted indices change
    effect(() => {
      const indices = this.submittedActualIndices();
      indices.forEach((idx) => {
        if (this.actualSplits?.at(idx)) {
          this.actualSplits.at(idx).disable({ emitEvent: false });
        }
      });
    });

    // Disable planned splits when locked
    effect(() => {
      if (this.isPlannedLocked() && this.plannedSplits) {
        this.plannedSplits.disable({ emitEvent: false });
      }
    });
  }

  setTab(tab: 'planned' | 'actual') {
    this.store.dispatch(ShipmentActions.setActiveSplitTab({ tab }));
  }

  getPlannedTotals() {
    const splits =
      this.activeSplitTab() === 'planned' ? this.plannedSplits : this.actualSplits;
    return splits.getRawValue().reduce(
      (acc, curr) => ({
        mt: acc.mt + (Number(curr['qtyMT']) || 0),
        fcl: acc.fcl + (Number(curr['FCL']) || 0),
      }),
      { mt: 0, fcl: 0 }
    );
  }

  isRowSubmitted(index: number): boolean {
    return this.submittedActualIndices().includes(index);
  }

  confirmPlannedSubmission() {
    if (this.plannedSplits.invalid) return;

    const shipmentData = this.shipmentData();
    if (!shipmentData) return;

    this.confirmationService.confirm({
      message: 'Lock the scheduled baseline? This will submit to the server and cannot be undone.',
      header: 'Confirm Scheduled Submission',
      icon: 'pi pi-lock',
      accept: () => {
        const containers = this.plannedSplits.getRawValue().map(c => ({
          ...c,
          etd: c.etd ? new Date(c.etd).toISOString().split('T')[0] : '',
          eta: c.eta ? new Date(c.eta).toISOString().split('T')[0] : '',
        }));
        this.store.dispatch(
          ShipmentActions.submitPlannedContainers({
            shipmentId: shipmentData.shipment._id || (shipmentData as any).shipment.id,
            containers: containers,
            plannedQtyMT: shipmentData.shipment.plannedQtyMT || 0,
          })
        );
      },
    });
  }

  confirmActualSubmission(index: number) {
    const row = this.actualSplits.at(index);
    if (row.invalid) return;

    if (!this.isPlannedLocked()) return;

    this.confirmationService.confirm({
      message: `Finalize record for Container #${index + 1}?`,
      header: 'Submit Actual',
      accept: () => {
        const formValue = row.getRawValue();
        const containerId = formValue['containerId'];
        if (!containerId) return;

        const payload = {
          qtyMT: formValue['qtyMT'] || 0,
          bags: formValue['bags'] || 0,
          buyingUnit: 'MT',
          updatedETD: formValue['updatedETD']
            ? new Date(formValue['updatedETD']).toISOString().split('T')[0]
            : '',
          updatedETA: formValue['updatedETA']
            ? new Date(formValue['updatedETA']).toISOString().split('T')[0]
            : '',
          BLNo: formValue['BLNo'] || '',
        };

        this.store.dispatch(
          ShipmentActions.submitActualContainer({ containerId, index, payload })
        );
      },
    });
  }
}
