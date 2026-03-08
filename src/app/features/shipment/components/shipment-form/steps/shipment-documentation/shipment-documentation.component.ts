import { Component, Input, Output, EventEmitter, inject, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormArray } from '@angular/forms';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { ConfirmationService } from 'primeng/api';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import { AccordionModule } from 'primeng/accordion';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import {
  selectSubmittedActualIndices,
  selectSubmittedStep3Indices,
  selectSubmittingRowIndex,
} from '../../../../../../store/shipment/shipment.selectors';
import * as ShipmentActions from '../../../../../../store/shipment/shipment.actions';

@Component({
  selector: 'app-shipment-documentation',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputTextModule,
    InputNumberModule,
    DatePickerModule,
    SelectModule,
    AccordionModule,
    ConfirmDialogModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './shipment-documentation.component.html',
})
export class ShipmentDocumentationComponent {
  @Input({ required: true }) formArray!: FormArray;
  @Output() navigateToSplit = new EventEmitter<void>();

  private store = inject(Store);
  private confirmationService = inject(ConfirmationService);

  readonly shipmentFiles = signal<Record<number, File[]>>({});

  onFilesSelected(event: Event, containerIndex: number): void {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    const newFiles = Array.from(input.files);
    this.shipmentFiles.update(current => ({
      ...current,
      [containerIndex]: [...(current[containerIndex] || []), ...newFiles],
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

  readonly receiverOptions = [
    { label: 'Bank', value: 'Bank' },
    { label: 'Direct', value: 'Direct' },
  ];

  readonly submittedIndices = toSignal(this.store.select(selectSubmittedStep3Indices), {
    initialValue: [],
  });
  readonly precedingIndices = toSignal(this.store.select(selectSubmittedActualIndices), {
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

  confirmSubmit(index: number) {
    const row = this.formArray.at(index);
    if (row.invalid || !this.isPrecedingSubmitted(index)) return;

    this.confirmationService.confirm({
      message: `Submit Documentation for Container #${index + 1}?`,
      header: 'Submit Documentation',
      accept: () => {
        const formValue = row.getRawValue();
        const containerId = formValue['containerId'];
        if (!containerId) return;

        const toDate = (val: any) =>
          val ? new Date(val).toISOString().split('T')[0] : '';

        this.store.dispatch(
          ShipmentActions.submitDocumentation({
            containerId,
            index,
            payload: {
              BLNo: formValue['BLNo'] || '',
              DHL: formValue['DHL'] || '',
              expectedDocDate: toDate(formValue['expectedDocDate']),
              receiver: formValue['receiver'] || '',
              bankAdvanceAmount: formValue['bankAdvanceAmount'] ?? null,
              bankAdvanceSubmittedOn: toDate(formValue['bankAdvanceSubmittedOn']),
              docToBeReleasedOn: toDate(formValue['docToBeReleasedOn']),
              documentCollectedOn: toDate(formValue['documentCollectedOn']),
            },
          })
        );
      },
    });
  }
}
