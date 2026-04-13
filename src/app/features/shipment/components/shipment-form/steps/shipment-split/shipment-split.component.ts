import { Component, Input, Output, EventEmitter, inject, effect, signal, computed, AfterViewInit, OnDestroy } from '@angular/core';
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
import { ToastModule } from 'primeng/toast';

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
import { ScheduledHistoryEntry, ExtractBillNoResponse } from '../../../../../../core/models/shipment.model';

export interface HistoryDiffRow {
  index: number;
  shipmentId: string;
  status: 'Added' | 'Removed' | 'Modified' | 'Unchanged';
  changes: {
    field: string;
    before: any;
    after: any;
  }[];
}


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
    ToastModule,
  ],

  providers: [ConfirmationService],
  templateUrl: './shipment-split.component.html',
  styleUrl: './shipment-split.component.scss',
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
  readonly billDocumentFiles = signal<Record<number, File | null>>({});
  readonly packagingListFiles = signal<Record<number, File | null>>({});
  readonly packagingBrands = signal<Record<number, string>>({});
  readonly showEtaShareModal = signal(false);
  readonly showEtaCalendar = signal(false);
  readonly etaCalendarDates = signal<Date[]>([]);
  readonly editablePlannedRows = signal<number[]>([]);

  /** True after user clicks Confirm (No of Shipments) so the input becomes readonly until lock. */
  readonly noOfShipmentsConfirmed = signal(false);

  readonly extractionMessages = [
    'Uploading your documents securely',
    'Royal AI is reading the BL document',
    'Extracting bill number and invoice references',
    'Preparing the extraction result for review'
  ];
  readonly extractionMessageIndex = signal(0);
  readonly extractionProgress = signal(18);
  readonly currentExtractionMessage = computed(() => this.extractionMessages[this.extractionMessageIndex()] || this.extractionMessages[0]);
  private extractionTicker: any = null;

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
      const data = this.shipmentData();
      const actual = data?.actual;
      const shipment = data?.shipment as any;
      if (!actual) return;
      
      const brands: Record<number, string> = {};
      
      // 1. Map brands from existing actual container data (saved in DB)
      actual.forEach((container, index) => {
        if (container.packagingList?.brand) {
          brands[index] = container.packagingList.brand;
        }
      });
      
      // 2. Auto-map brand if it's a single-item shipment and field is empty
      const items = shipment?.lineItems || shipment?.items || [];
      const autoBrand = (items.length === 1 ? (items[0]?.brandName || items[0]?.brand) : null) || shipment?.brandName || shipment?.brand;
      
      if (autoBrand) {
        console.log(`🏷️ [ShipmentSplit] Auto-mapping detected brand: "${autoBrand}"`);
        // Consider all rows currently in the UI (actualSplits)
        const uiRowsCount = this.actualSplits?.length || actual.length;
        
        for (let i = 0; i < uiRowsCount; i++) {
          if (!brands[i]) {
            console.log(`   🔸 Auto-filling row ${i} with brand`);
            brands[i] = autoBrand;
          }
        }
      } else {
        console.warn(`🏷️ [ShipmentSplit] Auto-mapping skipped: No single brand found in shipment data`, { itemsCount: items.length, shipment });
      }
      
      this.packagingBrands.set(brands);
    });

    effect(() => {
      this.isPlannedLocked();
      this.submittedActualIndices();
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
    this.stopExtractionExperience();
  }

  private startExtractionExperience(): void {
    this.stopExtractionExperience();
    this.extractionMessageIndex.set(0);
    this.extractionProgress.set(18);
    this.extractionTicker = setInterval(() => {
      this.extractionMessageIndex.update((index) => (index + 1) % this.extractionMessages.length);
      this.extractionProgress.update((value) => {
        if (value >= 88) return 26;
        return value + 12;
      });
    }, 1600);
  }

  private stopExtractionExperience(): void {
    if (this.extractionTicker) {
      clearInterval(this.extractionTicker);
      this.extractionTicker = null;
    }
  }

  private applyPlannedRowLockState(): void {
    if (!this.plannedSplits) return;
    const locked = this.isPlannedLocked();
    const editable = new Set(this.editablePlannedRows());
    const submittedActual = new Set(this.submittedActualIndices());

    this.plannedSplits.controls.forEach((control, index) => {
      if (submittedActual.has(index) || (locked && !editable.has(index))) {
        control.disable({ emitEvent: false });
      } else {
        control.enable({ emitEvent: false });
      }
    });
  }

  getPackingKg(): number {
    const p = this.shipmentData()?.shipment?.packing;
    if (p == null || p === '') return 20;
    
    // Attempt to specifically find a number immediately before KG/KGS
    const kgMatch = String(p).toUpperCase().match(/(\d+(?:\.\d+)?)\s*KGS?/);
    if (kgMatch && kgMatch[1]) {
      const num = parseFloat(kgMatch[1]);
      if (Number.isFinite(num) && num > 0) return num;
    }

    // Fallback block if KG prefix is not used explicitly
    const num = typeof p === 'number' ? p : parseFloat(String(p).replace(/[^0-9.]/g, ''));
    return Number.isFinite(num) && num > 0 ? num : 20;
  }

  getContainerCapacityMT(size: string | number | null | undefined): number {
    const s = size != null ? String(size).trim() : '';
    if (s === '40') return 26;
    return 25; // 20ft default
  }

  computeBagsAndPalletForRow(
    rowIndex: number,
    packingKg?: number
  ): { bags: number; pallet: number } | null {
    const row = this.actualSplits?.at(rowIndex);
    if (!row) return null;
    const kg = packingKg ?? this.getPackingKg();

    // Calculate based tightly on actual assigned MT instead of theoretical capacity
    const qtyMT = Number(row.get('qtyMT')?.value) || 0;
    if (qtyMT <= 0) return null;

    const totalKg = qtyMT * 1000;
    const bags = Math.round(totalKg / kg);
    
    // Each pallet fits 50 bags (adjusts down properly)
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
    if (this.isPlannedRowLocked(index)) return;
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

  private getShipmentTrackerBase(): string {
    const shipment = this.shipmentData()?.shipment as any;
    const shipmentNo = String(shipment?.shipmentNo || '').trim();
    const trackerPrefix = shipmentNo.match(/^(RHST-\d+\/[A-Z0-9]+)/i)?.[1];
    return trackerPrefix || shipment?.poNumber || shipment?.fpoNo || shipment?.orderNumber || shipmentNo || shipment?._id || '';
  }

  getShipmentTrackerId(): string {
    return this.getShipmentTrackerBase();
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
    const base = this.getShipmentTrackerBase() || 'RHST';
    return `${base}/SCG${String(index + 1).padStart(2, '0')}`;
  }

  getActualShipmentId(index: number): string {
    const base = this.getShipmentTrackerBase() || 'RHST';
    return `${base}/ACT${String(index + 1).padStart(2, '0')}`;
  }

  canDeletePlannedRow(index: number): boolean {
    if (this.isPlannedRowLocked(index)) return false;
    if (this.isPlannedLocked()) return false;
    if (this.plannedSplits.length <= 1) return false;
    const row = this.plannedSplits.at(index);
    return !!row?.get('isManualRow')?.value;
  }

  isPlannedRowLocked(index: number): boolean {
    return this.submittedActualIndices().includes(index);
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
    if (group.hasError('shipOnBoardBeforePoDate')) {
      return 'Ship Onboard Date must be later than PO Date.';
    }

    if (group.hasError('etdBeforePoDate')) {
      return 'ETD must be later than PO Date.';
    }

    if (group.hasError('etaBeforePoDate')) {
      return 'ETA must be later than PO Date.';
    }

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
    if (group.hasError('etdBeforePoDate')) {
      return 'ETD must be later than PO Date.';
    }

    if (group.hasError('etaBeforePoDate')) {
      return 'ETA must be later than PO Date.';
    }

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

  onPackagingListFileSelected(event: Event, rowIndex: number): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.packagingListFiles.update((current) => ({ ...current, [rowIndex]: file }));
    input.value = '';
  }

  onPackagingBrandChange(value: string, rowIndex: number): void {
    this.packagingBrands.update((current) => ({ ...current, [rowIndex]: value }));
  }

  /** Upload documents to extract details and autopopulate for the given row. */
  onExtractDetails(rowIndex: number): void {
    const blFile = this.billDocumentFiles()[rowIndex];
    const pkgFile = this.packagingListFiles()[rowIndex];
    const brand = this.packagingBrands()[rowIndex] || '';

    if (!blFile) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Missing BL',
        detail: 'Please upload the Bill of Lading document first.'
      });
      return;
    }

    const formData = new FormData();
    formData.append('file', blFile, blFile.name);
    if (pkgFile) {
      formData.append('packaging_list_file', pkgFile, pkgFile.name);
    }
    if (brand) {
      formData.append('packaging_brand', brand);
    }

    this.extractingBillNoRowIndex.set(rowIndex);
    this.startExtractionExperience();
    this.shipmentService.extractShipmentDetailsFromDocuments(formData).subscribe({
      next: (res: ExtractBillNoResponse) => {
        this.extractingBillNoRowIndex.set(null);
        this.stopExtractionExperience();
        
        const billData = res.bill_extracted_data || {};
        const pkgData = res.packaging_list || {};
        const billNo = billData.bill_no?.trim() || res.bill_no?.trim() || '';
        const invoiceNumber = billData.invoice_number?.trim() || res.invoice_number?.trim() || '';
        
        if (this.actualSplits?.at(rowIndex)) {
          const row = this.actualSplits.at(rowIndex);
          
          if (billNo) row.get('BLNo')?.setValue(billNo);
          if (invoiceNumber) row.get('commercialInvoiceNo')?.setValue(invoiceNumber);
          
          // Bill data
          if (billData.shipped_on_board_date) row.get('shipOnBoardDate')?.setValue(new Date(billData.shipped_on_board_date));
          if (billData.port_of_loading) row.get('portOfLoading')?.setValue(billData.port_of_loading);
          if (billData.port_of_discharge) row.get('portOfDischarge')?.setValue(billData.port_of_discharge);
          if (billData.number_of_containers != null) row.get('noOfContainers')?.setValue(billData.number_of_containers);
          if (billData.number_of_bags != null) row.get('noOfBags')?.setValue(billData.number_of_bags);
          if (billData.quantity_mt != null) row.get('quantityByMt')?.setValue(billData.quantity_mt);
          if (billData.shipping_line) row.get('shippingLine')?.setValue(billData.shipping_line);
          if (billData.free_detention_days != null) row.get('freeDetentionDays')?.setValue(billData.free_detention_days);
          if (billData.maximum_detention_days != null) row.get('maximumDetentionDays')?.setValue(billData.maximum_detention_days);
          if (typeof billData.freight_prepaid === 'boolean') row.get('freightPrepared')?.setValue(billData.freight_prepaid ? 'Yes' : 'No');
          
          row.get('billExtractionData')?.setValue(billData);
          
          // Extract brand from multiple possible locations in response
          const extractedBrand = 
            pkgData.brand || 
            billData.lineItems?.[0]?.brandName || 
            billData.brandName || 
            (res as any).brandName || 
            '';

          if (extractedBrand) {
            this.onPackagingBrandChange(extractedBrand, rowIndex);
          }

          // Packaging data
          row.get('packagingList')?.setValue(pkgData);
          if (Array.isArray(pkgData.container_info)) {
             row.get('extractedContainers')?.setValue(pkgData.container_info.map((c: any) => ({
                containerNo: c.container_number,
                pkgCt: c.no_of_bags
             })));
          } else if (Array.isArray(billData.containers)) {
             row.get('extractedContainers')?.setValue(billData.containers);
          }

          this.messageService.add({
            severity: 'success',
            summary: 'Details extracted',
            detail: 'Shipment and packaging details populated.'
          });
        }
      },
      error: (err: any) => {
        this.extractingBillNoRowIndex.set(null);
        this.stopExtractionExperience();
        this.messageService.add({
          severity: 'error',
          summary: 'Extraction failed',
          detail: err.error?.message ?? 'Could not extract details from documents.'
        });
      }
    });
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

    this.billDocumentFiles.update((current) => ({ ...current, [rowIndex]: file }));
    input.value = '';
  }

  getBillDocumentFile(rowIndex: number): File | null {
    return this.billDocumentFiles()[rowIndex] ?? null;
  }

  getPackagingListFile(rowIndex: number): File | null {
    return this.packagingListFiles()[rowIndex] ?? null;
  }

  clearBillDocumentFile(rowIndex: number): void {
    this.billDocumentFiles.update((current) => ({ ...current, [rowIndex]: null }));
  }

  clearPackagingListFile(rowIndex: number): void {
    this.packagingListFiles.update((current) => ({ ...current, [rowIndex]: null }));
  }

  openLocalBillDocumentPreview(rowIndex: number): void {
    const file = this.getBillDocumentFile(rowIndex);
    if (!file) return;
    const url = URL.createObjectURL(file);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  openSavedBillDocumentPreview(rowIndex: number): void {
    const url = this.getSavedBillDocumentUrl(rowIndex);
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  }

  getSavedBillDocumentUrl(index: number): string {
    return this.shipmentData()?.actual?.[index]?.blDocumentUrl || '';
  }

  getSavedBillDocumentName(index: number): string {
    return this.shipmentData()?.actual?.[index]?.blDocumentName || '';
  }

  openLocalPackagingListPreview(rowIndex: number): void {
    const file = this.getPackagingListFile(rowIndex);
    if (!file) return;
    const url = URL.createObjectURL(file);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  openSavedPackagingListPreview(rowIndex: number): void {
    const url = this.getSavedPackagingListUrl(rowIndex);
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  }

  getSavedPackagingListUrl(index: number): string {
    return this.shipmentData()?.actual?.[index]?.packagingListDocumentUrl || '';
  }

  getSavedPackagingListName(index: number): string {
    return this.shipmentData()?.actual?.[index]?.packagingListDocumentName || '';
  }

  confirmPlannedSubmission() {
    if (this.plannedSplits.invalid) return;

    const shipmentData = this.shipmentData();
    if (!shipmentData) return;

    this.confirmationService.confirm({
      message: 'Lock the scheduled ETA? This will submit to the server and cannot be undone.',
      header: 'Confirm Scheduled ETA',
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

  getRowDiffs(entry: ScheduledHistoryEntry): HistoryDiffRow[] {
    const diffs: HistoryDiffRow[] = [];
    const before = entry.before || [];
    const after = entry.after || [];

    const maxLen = Math.max(before.length, after.length);

    for (let i = 0; i < maxLen; i++) {
        const bRow = before[i];
        const aRow = after[i];

        if (!bRow && aRow) {
            diffs.push({ index: i, shipmentId: this.getScheduledShipmentId(i), status: 'Added', changes: [] });
        } else if (bRow && !aRow) {
            diffs.push({ index: i, shipmentId: this.getScheduledShipmentId(i), status: 'Removed', changes: [] });
        } else if (bRow && aRow) {
            const rowChanges: HistoryDiffRow['changes'] = [];
            
            // Compare fields
            if (Number(bRow.qtyMT) !== Number(aRow.qtyMT)) {
                rowChanges.push({ field: 'Qty MT', before: bRow.qtyMT, after: aRow.qtyMT });
            }
            if (Number(bRow.FCL) !== Number(aRow.FCL)) {
                rowChanges.push({ field: 'FCL', before: bRow.FCL, after: aRow.FCL });
            }
            if (bRow.size !== aRow.size) {
                rowChanges.push({ field: 'Size', before: bRow.size, after: aRow.size });
            }
            
            const bEtd = this.stripTime(bRow.etd);
            const aEtd = this.stripTime(aRow.etd);
            if (bEtd !== aEtd) {
                rowChanges.push({ field: 'ETD', before: bEtd, after: aEtd });
            }

            const bEta = this.stripTime(bRow.eta);
            const aEta = this.stripTime(aRow.eta);
            if (bEta !== aEta) {
                rowChanges.push({ field: 'ETA', before: bEta, after: aEta });
            }

            if (rowChanges.length > 0) {
                diffs.push({ index: i, shipmentId: this.getScheduledShipmentId(i), status: 'Modified', changes: rowChanges });
            } else {
                diffs.push({ index: i, shipmentId: this.getScheduledShipmentId(i), status: 'Unchanged', changes: [] });
            }
        }
    }

    return diffs;
  }

  stripTime(val: any): string {
    if (!val) return '—';
    const date = val instanceof Date ? val : new Date(val);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
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
    
    // Get shipment IDs (SCG IDs) of modified/added rows
    const diffs = this.getRowDiffs(entry);
    const affectedIds = diffs
      .filter(d => d.status !== 'Unchanged')
      .map(d => d.shipmentId.split('/').pop()) // Get just 'SCG01' etc.
      .filter(Boolean);
    
    const idList = affectedIds.length > 0 ? ` (${affectedIds.join(', ')})` : '';
    return `${beforeCount} -> ${afterCount} shipments${idList}`;
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

        const payload = new FormData();
        payload.append('actualSerialNo', this.getActualShipmentId(index));
        payload.append('commercialInvoiceNo', formValue['commercialInvoiceNo'] || '');
        payload.append('qtyMT', String(formValue['qtyMT'] || 0));
        payload.append('bags', String(formValue['bags'] || 0));
        payload.append('pallet', String(formValue['pallet'] || 0));
        payload.append('portOfLoading', formValue['portOfLoading'] || '');
        payload.append('portOfDischarge', formValue['portOfDischarge'] || '');
        payload.append('noOfContainers', String(formValue['noOfContainers'] || 0));
        payload.append('noOfBags', String(formValue['noOfBags'] || 0));
        payload.append('quantityByMt', String(formValue['quantityByMt'] || 0));
        payload.append('shippingLine', formValue['shippingLine'] || '');
        payload.append('freeDetentionDays', String(formValue['freeDetentionDays'] || 0));
        payload.append('maximumDetentionDays', String(formValue['maximumDetentionDays'] || 0));
        payload.append('freightPrepared', formValue['freightPrepared'] || 'No');
        payload.append('billExtractionData', JSON.stringify(formValue['billExtractionData'] || null));
        payload.append('extractedContainers', JSON.stringify(formValue['extractedContainers'] || []));
        payload.append('buyingUnit', 'MT');
        payload.append(
          'shipOnBoardDate',
          formValue['shipOnBoardDate'] ? new Date(formValue['shipOnBoardDate']).toISOString().split('T')[0] : ''
        );
        payload.append(
          'updatedETD',
          formValue['updatedETD'] ? new Date(formValue['updatedETD']).toISOString().split('T')[0] : ''
        );
        payload.append(
          'updatedETA',
          formValue['updatedETA'] ? new Date(formValue['updatedETA']).toISOString().split('T')[0] : ''
        );
        payload.append('BLNo', formValue['BLNo'] || '');

        const billDocument = this.getBillDocumentFile(index);
        if (billDocument) {
          payload.append('blDocument', billDocument, billDocument.name);
        }

        const packagingListDocument = this.getPackagingListFile(index);
        if (packagingListDocument) {
          payload.append('packaging_list_document', packagingListDocument, packagingListDocument.name);
        }

        const packagingList = row.get('packagingList')?.value;
        if (packagingList) {
          payload.append('packagingList', JSON.stringify(packagingList));
        }

        this.store.dispatch(
          ShipmentActions.submitActualContainer({ containerId, index, payload })
        );
      },
    });
  }
}
