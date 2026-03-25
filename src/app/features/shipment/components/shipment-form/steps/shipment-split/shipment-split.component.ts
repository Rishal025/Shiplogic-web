import { Component, Input, Output, EventEmitter, inject, effect, signal, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormArray, FormControl, FormGroup } from '@angular/forms';
import { FormsModule } from '@angular/forms';
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
import { DialogModule } from 'primeng/dialog';
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
import { ScheduledHistoryEntry } from '../../../../../../core/models/shipment.model';

@Component({
  selector: 'app-shipment-split',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    InputNumberModule,
    InputTextModule,
    DatePickerModule,
    ButtonModule,
    TableModule,
    ConfirmDialogModule,
    DialogModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './shipment-split.component.html',
})
export class ShipmentSplitComponent implements AfterViewInit, OnDestroy {
  readonly appDateFormat = 'dd/mm/yy';
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
  readonly showEtaCalendar = signal(false);
  readonly etaCalendarDates = signal<Date[]>([]);
  readonly editablePlannedRows = signal<number[]>([]);
  readonly showEtaShareModal = signal(false);

  /** True after user clicks Confirm (No of Shipments) so the input becomes readonly until lock. */
  readonly noOfShipmentsConfirmed = signal(false);

  private actualRecalcSub?: Subscription;
  private plannedLockSub?: Subscription;

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
      if (len === 0) {
        this.noOfShipmentsConfirmed.set(false);
        this.editablePlannedRows.set([]);
      }
    });

    effect(() => {
      this.isPlannedLocked();
      this.editablePlannedRows();
      this.applyPlannedRowLockState();
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

    if (this.plannedSplits?.valueChanges) {
      this.plannedLockSub = this.plannedSplits.valueChanges.pipe(debounceTime(0)).subscribe(() => {
        this.applyPlannedRowLockState();
      });
      queueMicrotask(() => this.applyPlannedRowLockState());
    }
  }

  ngOnDestroy(): void {
    this.actualRecalcSub?.unsubscribe();
    this.plannedLockSub?.unsubscribe();
  }

  private applyPlannedRowLockState(): void {
    if (!this.plannedSplits) return;
    const locked = this.isPlannedLocked();
    const editable = new Set(this.editablePlannedRows());

    this.plannedSplits.controls.forEach((control, index) => {
      if (locked && !editable.has(index)) {
        control.disable({ emitEvent: false });
      } else {
        control.enable({ emitEvent: false });
      }
    });
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

  setTab(tab: 'planned' | 'actual' | 'history') {
    this.store.dispatch(ShipmentActions.setActiveSplitTab({ tab }));
  }

  get scheduledHistory(): ScheduledHistoryEntry[] {
    return this.shipmentData()?.scheduledHistory || [];
  }

  isPlannedRowEditable(index: number): boolean {
    return this.editablePlannedRows().includes(index);
  }

  startPlannedRowEdit(index: number): void {
    if (!this.isPlannedLocked() || this.isPlannedRowEditable(index)) return;
    this.editablePlannedRows.set([...this.editablePlannedRows(), index].sort((a, b) => a - b));
  }

  cancelPlannedRowEdit(index: number): void {
    this.editablePlannedRows.set(this.editablePlannedRows().filter((rowIndex) => rowIndex !== index));
  }

  hasPendingPlannedEdits(): boolean {
    return this.editablePlannedRows().length > 0;
  }

  onConfirmNoOfShipments(): void {
    const no = Number(this.noOfShipmentsControl.value) || 0;
    if (no > 0 && this.totalQtyMT > 0) {
      this.noOfShipmentsConfirmed.set(true);
      this.confirmNoOfShipments.emit(no);
    }
  }

  /** Get week-of-month (W1-W5) from date for weekWiseShipment. */
  getWeekString(date: Date): string {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const weekNum = Math.ceil(d.getDate() / 7);
    return 'W' + weekNum;
  }

  /** When ETA is selected, auto-fill Week (week of month). */
  onEtaSelect(row: FormGroup, date: Date): void {
    if (date) {
      const weekStr = this.getWeekString(date instanceof Date ? date : new Date(date));
      row.get('weekWiseShipment')?.setValue(weekStr, { emitEvent: false });
    }
  }

  getMonthLabel(value: Date | string | null | undefined): string {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-US', { month: 'short' });
  }

  getWeekLabelForRow(row: FormGroup): string {
    const etaValue = row.get('eta')?.value;
    if (etaValue) {
      const etaDate = etaValue instanceof Date ? etaValue : new Date(etaValue);
      if (!Number.isNaN(etaDate.getTime())) {
        return this.getWeekString(etaDate);
      }
    }

    const weekValue = row.get('weekWiseShipment')?.value;
    return (typeof weekValue === 'string' && weekValue.trim()) ? weekValue : '—';
  }

  getEtaCalendarDates(): Date[] {
    return this.plannedSplits.controls
      .map((group) => group.get('eta')?.value)
      .filter((value): value is Date | string => Boolean(value))
      .map((value) => (value instanceof Date ? value : new Date(value)))
      .filter((date) => !Number.isNaN(date.getTime()));
  }

  openEtaCalendar(): void {
    this.etaCalendarDates.set(this.getEtaCalendarDates());
    this.showEtaShareModal.set(false);
    this.showEtaCalendar.set(true);
  }

  closeEtaCalendar(): void {
    this.showEtaShareModal.set(false);
    this.showEtaCalendar.set(false);
  }

  getEtaCalendarDateLabels(): string[] {
    return this.etaCalendarDates()
      .slice()
      .sort((left, right) => left.getTime() - right.getTime())
      .map((date) =>
        date.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        })
      );
  }

  getShipmentTrackerId(): string {
    const shipment = this.shipmentData()?.shipment as any;
    return shipment?.poNumber || shipment?.orderNumber || String(shipment?.shipmentNo || '').split('-')[0] || shipment?._id || '';
  }

  getEtaShareText(): string {
    const shipmentNo = this.shipmentData()?.shipment?.shipmentNo || 'Shipment';
    const trackerId = this.getShipmentTrackerId();
    const trackerUrl = typeof window !== 'undefined' ? window.location.href : '';

    return [
      `Shipment Tracker: ${shipmentNo}`,
      trackerId ? `Tracker ID: ${trackerId}` : null,
      trackerUrl ? `Tracker URL: ${trackerUrl}` : null,
      '',
      'Scheduled ETA Dates',
      ...this.getEtaCalendarDateLabels().map((label) => `- ${label}`),
    ]
      .filter(Boolean)
      .join('\n');
  }

  async shareEtaCalendarDates(): Promise<void> {
    const labels = this.getEtaCalendarDateLabels();
    if (!labels.length) {
      this.messageService.add({
        severity: 'info',
        summary: 'No ETA dates',
        detail: 'Add ETA dates first to share them.',
      });
      return;
    }

    const shareText = this.getEtaShareText();

    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Scheduled ETA Dates',
          text: shareText,
        });
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText);
        this.messageService.add({
          severity: 'success',
          summary: 'Copied',
          detail: 'ETA dates copied to clipboard for sharing.',
        });
        return;
      }

      throw new Error('Sharing is not supported on this device.');
    } catch (error) {
      const err = error as Error & { name?: string };
      if (err?.name === 'AbortError') {
        return;
      }

      this.messageService.add({
        severity: 'warn',
        summary: 'Share unavailable',
        detail: err?.message || 'Could not share ETA dates on this device.',
      });
    }
  }

  shareEtaCalendarOnWhatsApp(): void {
    const labels = this.getEtaCalendarDateLabels();
    if (!labels.length) {
      this.messageService.add({
        severity: 'info',
        summary: 'No ETA dates',
        detail: 'Add ETA dates first to share them.',
      });
      return;
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(this.getEtaShareText())}`, '_blank', 'noopener');
  }

  shareEtaCalendarViaEmail(): void {
    const labels = this.getEtaCalendarDateLabels();
    if (!labels.length) {
      this.messageService.add({
        severity: 'info',
        summary: 'No ETA dates',
        detail: 'Add ETA dates first to share them.',
      });
      return;
    }

    const shipmentNo = this.shipmentData()?.shipment?.shipmentNo || 'Shipment';
    const subject = encodeURIComponent(`ETA Calendar - ${shipmentNo}`);
    const body = encodeURIComponent(this.getEtaShareText());
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  openEtaShareModal(): void {
    const labels = this.getEtaCalendarDateLabels();
    if (!labels.length) {
      this.messageService.add({
        severity: 'info',
        summary: 'No ETA dates',
        detail: 'Add ETA dates first to share them.',
      });
      return;
    }

    this.showEtaShareModal.set(true);
  }

  closeEtaShareModal(): void {
    this.showEtaShareModal.set(false);
  }

  getShipmentNoForRow(index: number): string {
    const base = this.shipmentData()?.shipment?.shipmentNo || '';
    return base ? `${base}-${index + 1}` : `${index + 1}`;
  }

  getScheduledShipmentId(index: number): string {
    const shipment = this.shipmentData()?.shipment as any;
    const poFromPayload = shipment?.poNumber || shipment?.fpoNo || shipment?.orderNumber || '';
    const poFromShipmentNo = String(shipment?.shipmentNo || '').split('-')[0] || '';
    const base = poFromPayload || poFromShipmentNo || 'RHST';
    return `${base}/SCG${String(index + 1).padStart(2, '0')}`;
  }

  getActualShipmentId(index: number): string {
    const shipment = this.shipmentData()?.shipment as any;
    const poFromPayload = shipment?.poNumber || shipment?.fpoNo || shipment?.orderNumber || '';
    const poFromShipmentNo = String(shipment?.shipmentNo || '').split('-')[0] || '';
    const base = poFromPayload || poFromShipmentNo || 'RHST';
    return `${base}/ACT${String(index + 1).padStart(2, '0')}`;
  }

  canDeletePlannedRow(index: number): boolean {
    if (this.isPlannedLocked()) return false;
    if (this.plannedSplits.length <= 1) return false;
    const row = this.plannedSplits.at(index);
    return !!row?.get('isManualRow')?.value;
  }

  getActualRowDate(row: FormGroup, controlName: string): Date | null {
    const value = row.get(controlName)?.value;
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  getStrictMinDate(row: FormGroup, controlName: string): Date | undefined {
    const baseDate = this.getActualRowDate(row, controlName);
    if (!baseDate) return undefined;
    const minDate = new Date(baseDate);
    minDate.setDate(minDate.getDate() + 1);
    return minDate;
  }

  getActualDateError(group: FormGroup): string | null {
    if (group.hasError('etdBeforeShipOnBoard')) {
      return 'ETD must be later than Ship Onboard Date.';
    }

    if (group.hasError('etaBeforeShipOnBoard')) {
      return 'ETA must be later than Ship Onboard Date.';
    }

    if (group.hasError('etaBeforeEtd')) {
      return 'ETA must be later than ETD.';
    }

    return null;
  }

  getPlannedDateError(group: FormGroup): string | null {
    if (group.hasError('etaBeforeEtd')) {
      return 'ETA must be later than ETD.';
    }

    return null;
  }

  getPlannedTotals() {
    const splits = this.activeSplitTab() === 'actual' ? this.actualSplits : this.plannedSplits;
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
        const invoiceNumber = res.invoice_number?.trim() ?? '';
        if (billNo && this.actualSplits?.at(rowIndex)) {
          const row = this.actualSplits.at(rowIndex);
          row.get('BLNo')?.setValue(billNo);
          if (invoiceNumber) {
            row.get('commercialInvoiceNo')?.setValue(invoiceNumber);
          }
          if (res.shipped_on_board_date) row.get('shipOnBoardDate')?.setValue(new Date(res.shipped_on_board_date));
          if (res.port_of_loading) row.get('portOfLoading')?.setValue(res.port_of_loading);
          if (res.port_of_discharge) row.get('portOfDischarge')?.setValue(res.port_of_discharge);
          if (res.number_of_containers != null) row.get('noOfContainers')?.setValue(res.number_of_containers);
          if (res.number_of_bags != null) row.get('noOfBags')?.setValue(res.number_of_bags);
          if (res.quantity_mt != null) row.get('quantityByMt')?.setValue(res.quantity_mt);
          if (res.shipping_line) row.get('shippingLine')?.setValue(res.shipping_line);
          if (res.free_detention_days != null) row.get('freeDetentionDays')?.setValue(res.free_detention_days);
          if (res.maximum_detention_days != null) row.get('maximumDetentionDays')?.setValue(res.maximum_detention_days);
          if (typeof res.freight_prepaid === 'boolean') row.get('freightPrepared')?.setValue(res.freight_prepaid ? 'Yes' : 'No');
          row.get('billExtractionData')?.setValue(res);
          if (Array.isArray((res as any).containers)) row.get('extractedContainers')?.setValue((res as any).containers);
          this.messageService.add({
            severity: 'success',
            summary: 'Bill number extracted',
            detail: invoiceNumber
              ? `BL No. set to "${billNo}" and commercial invoice populated.`
              : `BL No. set to "${billNo}".`
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
        const targetNoOfShipments = Number(this.noOfShipmentsControl.value) || this.plannedSplits.length;
        const containers = this.plannedSplits.getRawValue().slice(0, targetNoOfShipments).map(c => ({
          ...c,
          etd: c.etd ? new Date(c.etd).toISOString().split('T')[0] : '',
          eta: c.eta ? new Date(c.eta).toISOString().split('T')[0] : '',
        }));
        this.store.dispatch(
          ShipmentActions.submitPlannedContainers({
            shipmentId: shipmentData.shipment._id || (shipmentData as any).shipment.id,
            containers: containers,
            plannedQtyMT: shipmentData.shipment.plannedQtyMT || 0,
            noOfShipments: targetNoOfShipments,
            keepTab: this.isPlannedLocked(),
          })
        );
        this.editablePlannedRows.set([]);
      },
    });
  }

  formatHistoryTimestamp(value: string | Date | null | undefined): string {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  summarizeHistoryChange(entry: ScheduledHistoryEntry): string {
    const beforeCount = entry.before?.length || 0;
    const afterCount = entry.after?.length || 0;
    const beforeQty = (entry.before || []).reduce((sum, row) => sum + (Number(row.qtyMT) || 0), 0);
    const afterQty = (entry.after || []).reduce((sum, row) => sum + (Number(row.qtyMT) || 0), 0);
    return `${beforeCount} -> ${afterCount} rows, ${beforeQty} MT -> ${afterQty} MT`;
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
          actualSerialNo: this.getActualShipmentId(index),
          commercialInvoiceNo: formValue['commercialInvoiceNo'] || '',
          qtyMT: formValue['qtyMT'] || 0,
          bags: formValue['bags'] || 0,
          pallet: formValue['pallet'] || 0,
          portOfLoading: formValue['portOfLoading'] || '',
          portOfDischarge: formValue['portOfDischarge'] || '',
          noOfContainers: formValue['noOfContainers'] || 0,
          noOfBags: formValue['noOfBags'] || 0,
          quantityByMt: formValue['quantityByMt'] || 0,
          shippingLine: formValue['shippingLine'] || '',
          freeDetentionDays: formValue['freeDetentionDays'] || 0,
          maximumDetentionDays: formValue['maximumDetentionDays'] || 0,
          freightPrepared: formValue['freightPrepared'] || 'No',
          billExtractionData: formValue['billExtractionData'] || null,
          extractedContainers: formValue['extractedContainers'] || [],
          buyingUnit: 'MT',
          shipOnBoardDate: formValue['shipOnBoardDate']
            ? new Date(formValue['shipOnBoardDate']).toISOString().split('T')[0]
            : '',
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
