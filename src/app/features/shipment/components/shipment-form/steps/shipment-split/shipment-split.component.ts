import { Component, Input, Output, EventEmitter, inject, effect, signal, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormArray, FormControl, FormGroup } from '@angular/forms';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { debounceTime } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { ConfirmationService, MessageService } from 'primeng/api';
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
import { ShipmentService } from '../../../../../../core/services/shipment.service';

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
export class ShipmentSplitComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) plannedSplits!: FormArray;
  @Input({ required: true }) actualSplits!: FormArray;
  @Input({ required: true }) noOfShipmentsControl!: FormControl<number | null>;
  @Input() totalQtyMT = 0;
  @Output() addActual = new EventEmitter<void>();
  @Output() removeActual = new EventEmitter<number>();
  @Output() confirmNoOfShipments = new EventEmitter<number>();
  @Output() addPlannedRow = new EventEmitter<void>();
  @Output() removePlannedRow = new EventEmitter<number>();

  private store = inject(Store);
  private confirmationService = inject(ConfirmationService);
  private shipmentService = inject(ShipmentService);
  private messageService = inject(MessageService);

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

  /** Row index for which bill-no extraction is in progress (show spinner). */
  readonly extractingBillNoRowIndex = signal<number | null>(null);

  /** True after user clicks Confirm (No of Shipments) so the input becomes readonly until lock. */
  readonly noOfShipmentsConfirmed = signal(false);

  private actualRecalcSub?: Subscription;

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

    // Reset confirmed state when planned rows are cleared (e.g. new shipment loaded)
    effect(() => {
      const len = this.plannedSplits?.length ?? 0;
      if (len === 0) this.noOfShipmentsConfirmed.set(false);
    });

    // Auto-calculate bags and pallet for Actual tab rows from FCL, size, and packing
    effect(() => {
      if (this.activeSplitTab() !== 'actual' || !this.actualSplits?.length) return;
      const packingKg = this.getPackingKg();
      const submitted = this.submittedActualIndices();
      for (let i = 0; i < this.actualSplits.length; i++) {
        if (submitted.includes(i)) continue;
        const computed = this.computeBagsAndPalletForRow(i, packingKg);
        if (computed) {
          this.actualSplits.at(i).patchValue(
            { bags: computed.bags, pallet: computed.pallet },
            { emitEvent: false }
          );
        }
      }
    });

    // Re-run bags/pallet calc when actual form values change (e.g. parent patched after add/load)
    // Subscription is set up in ngAfterViewInit when actualSplits is available.
  }

  ngAfterViewInit(): void {
    if (this.actualSplits?.valueChanges) {
      this.actualRecalcSub = this.actualSplits.valueChanges.pipe(debounceTime(0)).subscribe(() => {
        if (this.activeSplitTab() !== 'actual' || !this.actualSplits?.length) return;
        const packingKg = this.getPackingKg();
        const submitted = this.submittedActualIndices();
        for (let i = 0; i < this.actualSplits.length; i++) {
          if (submitted.includes(i)) continue;
          const computed = this.computeBagsAndPalletForRow(i, packingKg);
          if (computed) {
            this.actualSplits.at(i).patchValue(
              { bags: computed.bags, pallet: computed.pallet },
              { emitEvent: false }
            );
          }
        }
      });
    }
  }

  ngOnDestroy(): void {
    this.actualRecalcSub?.unsubscribe();
  }

  /** Parse packing (e.g. "20 KG" or 20) to number in KG. Default 20. */
  getPackingKg(): number {
    const p = this.shipmentData()?.shipment?.packing;
    if (p == null || p === '') return 20;
    const num = typeof p === 'number' ? p : parseFloat(String(p).replace(/[^0-9.]/g, ''));
    return Number.isFinite(num) && num > 0 ? num : 20;
  }

  /** Container capacity in MT: 20ft = 25, 40ft = 26. */
  getContainerCapacityMT(size: string | number | null | undefined): number {
    const s = size != null ? String(size).trim() : '';
    if (s === '40') return 26;
    return 25; // 20ft default
  }

  /**
   * Compute bags and pallet for an Actual row.
   * Bags per container = (container capacity in KG) / packing (KG).
   * Total Bags = Bags per container × FCL.
   * Total Pallet = Total Bags / 50.
   */
  computeBagsAndPalletForRow(
    rowIndex: number,
    packingKg?: number
  ): { bags: number; pallet: number } | null {
    const row = this.actualSplits?.at(rowIndex);
    if (!row) return null;
    const kg = packingKg ?? this.getPackingKg();
    const capacityMT = this.getContainerCapacityMT(row.get('size')?.value);
    const fcl = Number(row.get('FCL')?.value) || 0;
    if (fcl <= 0) return null;
    const capacityKg = capacityMT * 1000;
    const bagsPerContainer = capacityKg / kg;
    const bags = Math.round(bagsPerContainer * fcl);
    const pallet = Math.round(bags / 50);
    return { bags, pallet };
  }

  setTab(tab: 'planned' | 'actual') {
    this.store.dispatch(ShipmentActions.setActiveSplitTab({ tab }));
  }

  onConfirmNoOfShipments(): void {
    const no = Number(this.noOfShipmentsControl.value) || 0;
    if (no > 0 && this.totalQtyMT > 0) {
      this.noOfShipmentsConfirmed.set(true);
      this.confirmNoOfShipments.emit(no);
    }
  }

  /** Get ISO week number (1–53) from date and return "W" + number for weekWiseShipment. */
  getWeekString(date: Date): string {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const start = new Date(d.getFullYear(), 0, 1);
    const dayNum = Math.floor((d.getTime() - start.getTime()) / 86400000);
    const weekNum = Math.ceil((dayNum + start.getDay() + 1) / 7);
    return 'W' + weekNum;
  }

  /** When ETA is selected, auto-fill Week (week of year). */
  onEtaSelect(row: FormGroup, date: Date): void {
    if (date) {
      const weekStr = this.getWeekString(date instanceof Date ? date : new Date(date));
      row.get('weekWiseShipment')?.setValue(weekStr, { emitEvent: false });
    }
  }

  getShipmentNoForRow(index: number): string {
    const base = this.shipmentData()?.shipment?.shipmentNo || '';
    return base ? `${base}-${index + 1}` : `${index + 1}`;
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

  /** Upload a document to extract bill number and autopopulate BL No for the given row. */
  onBillNoFileSelected(event: Event, rowIndex: number): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    const allowedExt = /\.(pdf|jpg|jpeg|png|gif|webp)$/i;
    if (!allowedTypes.includes(file.type) && !allowedExt.test(file.name)) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Invalid file',
        detail: 'Only PDF and image files (e.g. JPG, PNG) are allowed.'
      });
      input.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('file', file, file.name);

    this.extractingBillNoRowIndex.set(rowIndex);
    this.shipmentService.extractBillNoFromDocument(formData).subscribe({
      next: (res) => {
        this.extractingBillNoRowIndex.set(null);
        const billNo = res.bill_no?.trim() ?? '';
        if (billNo && this.actualSplits?.at(rowIndex)) {
          this.actualSplits.at(rowIndex).get('BLNo')?.setValue(billNo);
          this.messageService.add({
            severity: 'success',
            summary: 'Bill number extracted',
            detail: `BL No. set to "${billNo}".`
          });
        } else if (!billNo) {
          this.messageService.add({
            severity: 'warn',
            summary: 'No bill number found',
            detail: 'The document did not contain a recognizable bill number.'
          });
        }
        input.value = '';
      },
      error: (err) => {
        this.extractingBillNoRowIndex.set(null);
        this.messageService.add({
          severity: 'error',
          summary: 'Extraction failed',
          detail: err.error?.message ?? 'Could not extract bill number from document.'
        });
        input.value = '';
      }
    });
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
        const noOfShipments = Number(this.noOfShipmentsControl.value) || this.plannedSplits.length;
        this.store.dispatch(
          ShipmentActions.submitPlannedContainers({
            shipmentId: shipmentData.shipment._id || (shipmentData as any).shipment.id,
            containers: containers,
            plannedQtyMT: shipmentData.shipment.plannedQtyMT || 0,
            noOfShipments,
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
