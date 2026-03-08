import { Component, Input, inject, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormArray, FormBuilder, AbstractControl } from '@angular/forms';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { ConfirmationService } from 'primeng/api';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { AccordionModule } from 'primeng/accordion';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { SelectModule } from 'primeng/select';
import {
  selectSubmittedStep3Indices,
  selectSubmittedStep4Indices,
  selectSubmittingRowIndex,
} from '../../../../../../store/shipment/shipment.selectors';
import * as ShipmentActions from '../../../../../../store/shipment/shipment.actions';

@Component({
  selector: 'app-shipment-arrival',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputTextModule,
    InputNumberModule,
    DatePickerModule,
    AccordionModule,
    ConfirmDialogModule,
    SelectModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './shipment-arrival.component.html',
})
export class ShipmentArrivalComponent {
  @Input({ required: true }) formArray!: FormArray;

  readonly shipmentFiles = signal<Record<number, File[]>>({});

  onFilesSelected(event: Event, containerIndex: number): void {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    this.shipmentFiles.update(current => ({
      ...current,
      [containerIndex]: [...(current[containerIndex] || []), ...Array.from(input.files!)],
    }));
    input.value = '';
  }

  removeShipmentFile(containerIndex: number, fileIndex: number): void {
    this.shipmentFiles.update(current => {
      const files = [...(current[containerIndex] || [])];
      files.splice(fileIndex, 1);
      return { ...current, [containerIndex]: files };
    });
  }

  getShipmentFiles(containerIndex: number): File[] {
    return this.shipmentFiles()[containerIndex] || [];
  }

  readonly clearingStatusOptions = [
    { label: 'Docs Pending', value: 'Docs Pending' },
    { label: 'Under Clearance', value: 'Under Clearance' },
    { label: 'Inspection', value: 'Inspection' },
    { label: 'Duty Pending', value: 'Duty Pending' },
    { label: 'Cleared', value: 'Cleared' },
    { label: 'Released', value: 'Released' },
    { label: 'Other Reason', value: 'Other Reason' },
  ];

  private store = inject(Store);
  private fb = inject(FormBuilder);
  private confirmationService = inject(ConfirmationService);

  readonly submittedIndices = toSignal(this.store.select(selectSubmittedStep4Indices), {
    initialValue: [],
  });
  readonly precedingIndices = toSignal(this.store.select(selectSubmittedStep3Indices), {
    initialValue: [],
  });
  readonly submittingRowIndex = toSignal(this.store.select(selectSubmittingRowIndex), {
    initialValue: null,
  });

  constructor() {
    effect(() => {
      const indices = this.submittedIndices();
      indices.forEach((idx) => {
        if (this.formArray?.at(idx)) {
          this.formArray.at(idx).disable({ emitEvent: false });
        }
      });
    });
  }

  isRowSubmitted(index: number): boolean {
    return this.submittedIndices().includes(index);
  }

  isPrecedingSubmitted(index: number): boolean {
    return this.precedingIndices().includes(index);
  }

  getDeliverySchedules(group: AbstractControl): FormArray {
    return group.get('deliverySchedules') as FormArray;
  }

  addDeliverySchedule(group: AbstractControl, containerIndex: number): void {
    if (this.isRowSubmitted(containerIndex)) return;
    this.getDeliverySchedules(group).push(
      this.fb.group({ date: [null], noOfFCL: [null], time: [''], location: [''] })
    );
  }

  removeDeliverySchedule(group: AbstractControl, scheduleIndex: number): void {
    this.getDeliverySchedules(group).removeAt(scheduleIndex);
  }

  confirmSubmit(index: number) {
    const row = this.formArray.at(index);
    if (row.invalid || !this.isPrecedingSubmitted(index)) return;

    this.confirmationService.confirm({
      message: `Submit Arrival for Container #${index + 1}?`,
      header: 'Submit Arrival',
      accept: () => {
        const formValue = row.getRawValue();
        const containerId = formValue['containerId'];
        if (!containerId) return;

        const toDate = (val: any) =>
          val ? new Date(val).toISOString().split('T')[0] : '';

        this.store.dispatch(
          ShipmentActions.submitLogistics({
            containerId,
            index,
            payload: {
              shipmentArrivedOn: toDate(formValue['shipmentArrivedOn']),
              clearExpectedOn: toDate(formValue['clearExpectedOn']),
              deliverySchedules: (formValue['deliverySchedules'] || []).map((ds: any) => ({
                date: toDate(ds.date),
                noOfFCL: ds.noOfFCL,
                time: ds.time || '',
                location: ds.location || '',
              })),
              receivedOn: toDate(formValue['receivedOn']),
              grnNo: formValue['grnNo'] || '',
              qualityInspectionReportDate: toDate(formValue['qualityInspectionReportDate']),
            },
          })
        );
      },
    });
  }
}
