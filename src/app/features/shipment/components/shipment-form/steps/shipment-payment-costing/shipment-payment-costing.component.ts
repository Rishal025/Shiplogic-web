import { Component, Input, computed, inject, signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { AccordionModule } from 'primeng/accordion';
import { TableModule } from 'primeng/table';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { selectShipmentData } from '../../../../../../store/shipment/shipment.selectors';
import {
  selectIsPlannedLocked,
  selectSubmittedActualIndices,
  selectSubmittedStep3Indices,
  selectSubmittedStep4Indices,
  selectSubmittedStep5Indices,
  selectSubmittedStep6Indices,
  selectSubmittedStep7Indices,
} from '../../../../../../store/shipment/shipment.selectors';
import { ShipmentService } from '../../../../../../core/services/shipment.service';
import { NotificationService } from '../../../../../../core/services/notification.service';
import * as ShipmentActions from '../../../../../../store/shipment/shipment.actions';

@Component({
  selector: 'app-shipment-payment-costing',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    AccordionModule,
    DatePickerModule,
    DialogModule,
    InputNumberModule,
    InputTextModule,
    TableModule,
  ],
  templateUrl: './shipment-payment-costing.component.html',
})
export class ShipmentPaymentCostingComponent {
  @Input({ required: true }) formArray!: FormArray;

  @ViewChild('refBillDocInput') refBillDocInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('paymentCostingDocInput') paymentCostingDocInputRef?: ElementRef<HTMLInputElement>;

  private fb = inject(FormBuilder);
  private sanitizer = inject(DomSanitizer);
  private store = inject(Store);
  private shipmentService = inject(ShipmentService);
  private notificationService = inject(NotificationService);

  readonly shipmentData = toSignal(this.store.select(selectShipmentData));
  readonly activeTabs = signal<Record<number, 'allocation' | 'costing'>>({});
  readonly isPlannedLocked = toSignal(this.store.select(selectIsPlannedLocked), { initialValue: false });
  readonly submittedActualIndices = toSignal(this.store.select(selectSubmittedActualIndices), { initialValue: [] });
  readonly submittedStep3Indices = toSignal(this.store.select(selectSubmittedStep3Indices), { initialValue: [] });
  readonly submittedStep4Indices = toSignal(this.store.select(selectSubmittedStep4Indices), { initialValue: [] });
  readonly submittedStep5Indices = toSignal(this.store.select(selectSubmittedStep5Indices), { initialValue: [] });
  readonly submittedStep6Indices = toSignal(this.store.select(selectSubmittedStep6Indices), { initialValue: [] });
  readonly submittedStep7Indices = toSignal(this.store.select(selectSubmittedStep7Indices), { initialValue: [] });
  readonly expandedAllocations = signal<Record<number, boolean>>({});
  readonly expandedCostings = signal<Record<number, boolean>>({});
  readonly savingRowIndex = signal<number | null>(null);
  readonly packagingModalVisible = signal(false);
  readonly packagingModalShipmentIndex = signal<number | null>(null);

  private pendingUpload: { shipmentIndex: number; rowIndex: number } | null = null;
  readonly refBillFiles = signal<Record<string, File | null>>({});
  readonly paymentCostingFiles = signal<Record<number, File | null>>({});
  readonly statusModalVisible = signal(false);
  readonly statusModalShipmentIndex = signal<number | null>(null);

  readonly shipmentStages = [
    'Shipment Entry',
    'Shipment Tracker',
    'BL Details',
    'Document Tracker',
    'Port and Customs Clearance Tracker',
    'Storage Allocation & Arrival',
    'Quality',
    'Payment & Costing',
  ] as const;

  showPreviewModal = signal(false);
  previewUrl = signal<string | null>(null);
  previewTitle = signal('');
  previewIsImage = signal(false);
  previewZoom = signal(1);
  previewTransformOrigin = signal('center center');
  previewSafeUrl = computed(() => {
    const url = this.previewUrl();
    if (!url || this.previewIsImage()) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  getShipmentNoLabel(index: number): string {
    if (this.formArray?.controls[index] == null) return '–';
    const base = this.shipmentData()?.shipment?.shipmentNo?.replace(/\([^)]*\)/g, '').trim();
    return base?.trim() ? `${base}-${index + 1}` : '–';
  }

  private formatCurrency(value: unknown): string {
    return Number(value ?? 0).toFixed(2);
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatDateForReport(value: unknown): string {
    if (!value) return '—';
    const date = new Date(value as string | Date);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  private downloadCostingSheetPdf(config: {
    shipmentNo: string;
    metadataRows: [string, string][];
    clearingRows: Array<{
      sn: number | string;
      description: string;
      requestAmount: string;
      paidAmount: string;
      actualAmount?: string;
      remarks?: string;
    }>;
    packagingRows?: Array<{
      sn: number | string;
      item: string;
      packing: string;
      qty: string;
      uom: string;
      unitCostFC: string;
      unitCostDH: string;
      totalCostFC: string;
      totalCostDH: string;
      expenseAllocationFactor: string;
      expensesAllocated: string;
      totalValueWithExpenses: string;
      landedCostPerUnit: string;
      reference?: string;
    }>;
  }): void {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

    doc.setFontSize(18);
    doc.text('Royal Horizon Costing Sheet', 40, 36);
    doc.setFontSize(11);
    doc.text(`Shipment: ${config.shipmentNo}`, 40, 54);

    autoTable(doc, {
      startY: 70,
      body: config.metadataRows.map(([label, value]) => [label, value || '—']),
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: {
        0: { fontStyle: 'bold', fillColor: [248, 250, 252], cellWidth: 150 },
        1: { cellWidth: 250 },
      },
      margin: { left: 40, right: 40 },
    });

    const clearingRows = config.clearingRows.map((row) => [
      row.sn,
      row.description,
      row.requestAmount,
      row.paidAmount,
      row.actualAmount || '0.00',
      row.remarks || '',
    ]);
    clearingRows.push([
      '',
      'Total',
      config.clearingRows.reduce((sum, row) => sum + Number(row.requestAmount || 0), 0).toFixed(2),
      config.clearingRows.reduce((sum, row) => sum + Number(row.paidAmount || 0), 0).toFixed(2),
      config.clearingRows.reduce((sum, row) => sum + Number(row.actualAmount || 0), 0).toFixed(2),
      '',
    ]);

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 18,
      head: [['SN', 'Description', 'Request Amount', 'Paid Amount', 'Actual Amount', 'Payment Ref / Remarks']],
      body: clearingRows,
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 4 },
      headStyles: { fillColor: [241, 245, 249], textColor: 17, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 34 },
        1: { cellWidth: 250 },
        2: { halign: 'right', cellWidth: 85 },
        3: { halign: 'right', cellWidth: 85 },
        4: { halign: 'right', cellWidth: 85 },
        5: { cellWidth: 170 },
      },
      margin: { left: 40, right: 40 },
    });

    if (config.packagingRows?.length) {
      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 18,
        head: [[
          'SN', 'Item', 'Packing', 'Qty', 'UOM', 'Unit Cost FC', 'Unit Cost DH', 'Total Cost FC', 'Total Cost DH',
          'Allocation Factor', 'Expenses Allocated', 'Total Value With Expenses', 'Landed Cost / Unit', 'Reference'
        ]],
        body: config.packagingRows.map((row) => [
          row.sn,
          row.item,
          row.packing,
          row.qty,
          row.uom,
          row.unitCostFC,
          row.unitCostDH,
          row.totalCostFC,
          row.totalCostDH,
          row.expenseAllocationFactor,
          row.expensesAllocated,
          row.totalValueWithExpenses,
          row.landedCostPerUnit,
          row.reference || '',
        ]),
        theme: 'grid',
        styles: { fontSize: 7.5, cellPadding: 3 },
        headStyles: { fillColor: [241, 245, 249], textColor: 17, fontStyle: 'bold' },
        margin: { left: 40, right: 40 },
      });
    }

    doc.save(`${config.shipmentNo.replace(/[^a-z0-9_-]/gi, '_')}-costing-sheet.pdf`);
  }

  openStatusModal(index: number): void {
    this.statusModalShipmentIndex.set(index);
    this.statusModalVisible.set(true);
  }

  onStatusModalVisibleChange(visible: boolean): void {
    this.statusModalVisible.set(visible);
    if (!visible) this.statusModalShipmentIndex.set(null);
  }

  getShipmentReachedStage(index: number): string {
    if (this.submittedStep7Indices().includes(index)) return 'Payment & Costing';
    if (this.submittedStep6Indices().includes(index)) return 'Quality';
    if (this.submittedStep5Indices().includes(index)) return 'Storage Allocation & Arrival';
    if (this.submittedStep4Indices().includes(index)) return 'Port and Customs Clearance Tracker';
    if (this.submittedStep3Indices().includes(index)) return 'Document Tracker';
    if (this.submittedActualIndices().includes(index)) return 'BL Details';
    if (this.isPlannedLocked()) return 'Shipment Tracker';
    return 'Shipment Entry';
  }

  isStageCompletedForShipment(index: number, stageIndex: number): boolean {
    if (stageIndex === 0) return true;
    if (stageIndex === 1) return this.isPlannedLocked();
    if (stageIndex === 2) return this.submittedActualIndices().includes(index);
    if (stageIndex === 3) return this.submittedStep3Indices().includes(index);
    if (stageIndex === 4) return this.submittedStep4Indices().includes(index);
    if (stageIndex === 5) return this.submittedStep5Indices().includes(index);
    if (stageIndex === 6) return this.submittedStep6Indices().includes(index);
    if (stageIndex === 7) return this.submittedStep7Indices().includes(index);
    return false;
  }

  isCurrentStageForShipment(index: number, stageIndex: number): boolean {
    const reached = this.getShipmentReachedStage(index);
    return this.shipmentStages[stageIndex] === reached;
  }

  getActiveTab(index: number): 'allocation' | 'costing' {
    return this.activeTabs()[index] ?? 'allocation';
  }

  setActiveTab(index: number, tab: 'allocation' | 'costing'): void {
    this.activeTabs.update((cur) => ({ ...cur, [index]: tab }));
  }

  getPaymentAllocations(group: AbstractControl): FormArray {
    return (group as FormGroup).get('paymentAllocations') as FormArray;
  }

  getPaymentCostings(group: AbstractControl): FormArray {
    return (group as FormGroup).get('paymentCostings') as FormArray;
  }

  getPackagingExpenses(group: AbstractControl): FormArray {
    return (group as FormGroup).get('packagingExpenses') as FormArray;
  }

  getVisiblePaymentAllocations(group: AbstractControl, shipmentIndex: number): AbstractControl[] {
    const rows = this.getPaymentAllocations(group).controls;
    return this.expandedAllocations()[shipmentIndex] ? rows : rows.slice(0, 5);
  }

  hasHiddenPaymentAllocations(group: AbstractControl): boolean {
    return this.getPaymentAllocations(group).length > 5;
  }

  togglePaymentAllocations(shipmentIndex: number): void {
    this.expandedAllocations.update((cur) => ({ ...cur, [shipmentIndex]: !cur[shipmentIndex] }));
  }

  getVisiblePaymentCostings(group: AbstractControl, shipmentIndex: number): AbstractControl[] {
    const rows = this.getPaymentCostings(group).controls;
    return this.expandedCostings()[shipmentIndex] ? rows : rows.slice(0, 5);
  }

  hasHiddenPaymentCostings(group: AbstractControl): boolean {
    return this.getPaymentCostings(group).length > 5;
  }

  togglePaymentCostings(shipmentIndex: number): void {
    this.expandedCostings.update((cur) => ({ ...cur, [shipmentIndex]: !cur[shipmentIndex] }));
  }

  addAllocationRow(group: AbstractControl): void {
    const allocations = this.getPaymentAllocations(group);
    const costings = this.getPaymentCostings(group);
    const sn = allocations.length + 1;
    allocations.push(
      this.fb.group({
        sn: [sn],
        description: [''],
        requestAmount: [null],
      })
    );
    costings.push(
      this.fb.group({
        sn: [sn],
        description: [''],
        requestAmount: [null],
        actualPaid: [null],
        refBillDate: [null],
        refBillVendor: [''],
      })
    );
  }

  addPackagingExpenseRow(group: AbstractControl): void {
    const rows = this.getPackagingExpenses(group);
    rows.push(
      this.fb.group({
        sn: [rows.length + 1],
        item: [''],
        packing: [''],
        qty: [null],
        uom: [''],
        unitCostFC: [null],
        unitCostDH: [null],
        totalCostFC: [null],
        totalCostDH: [null],
        expenseAllocationFactor: [null],
        expensesAllocated: [null],
        totalValueWithExpenses: [null],
        landedCostPerUnit: [null],
        reference: [''],
      })
    );
  }

  openPackagingExpensesModal(index: number): void {
    this.packagingModalShipmentIndex.set(index);
    this.packagingModalVisible.set(true);
  }

  closePackagingExpensesModal(): void {
    this.packagingModalVisible.set(false);
    this.packagingModalShipmentIndex.set(null);
  }

  onPackagingModalVisibleChange(visible: boolean): void {
    this.packagingModalVisible.set(visible);
    if (!visible) this.packagingModalShipmentIndex.set(null);
  }

  addPackagingExpenseRowForShipment(index: number): void {
    const group = this.formArray.at(index);
    if (!group) return;
    this.addPackagingExpenseRow(group);
  }

  getPackagingModalShipmentGroup(): AbstractControl | null {
    const index = this.packagingModalShipmentIndex();
    if (index == null) return null;
    return this.formArray.at(index) ?? null;
  }

  getPackagingModalShipmentIndexValue(): number {
    return this.packagingModalShipmentIndex() ?? 0;
  }

  clickPaymentCostingUpload(shipmentIndex: number): void {
    this.pendingUpload = null;
    const input = this.paymentCostingDocInputRef?.nativeElement;
    if (input) {
      input.dataset['shipmentIndex'] = String(shipmentIndex);
      input.click();
    }
  }

  syncCostingFromAllocation(group: AbstractControl, index: number): void {
    const allocations = this.getPaymentAllocations(group);
    const costings = this.getPaymentCostings(group);
    const allocation = allocations.at(index) as FormGroup;
    let costing = costings.at(index) as FormGroup | null;
    if (!costing) {
      costing = this.fb.group({
        sn: [index + 1],
        description: [''],
        requestAmount: [null],
        actualPaid: [null],
        refBillDate: [null],
        refBillVendor: [''],
      });
      costings.push(costing);
    }
    costing.patchValue(
      {
        sn: allocation.get('sn')?.value ?? index + 1,
        description: allocation.get('description')?.value ?? '',
        requestAmount: allocation.get('requestAmount')?.value ?? null,
        paidAmount: allocation.get('paidAmount')?.value ?? null,
      },
      { emitEvent: false }
    );
  }

  onRefBillNoInput(group: AbstractControl, rowIndex: number): void {
    const costings = this.getPaymentCostings(group);
    const row = costings.at(rowIndex) as FormGroup;
    const refBillNo = String(row.get('refBillNo')?.value || '').trim();
    
    // If user types a bill number and date is empty, default to today
    if (refBillNo && !row.get('refBillDate')?.value) {
      row.get('refBillDate')?.setValue(new Date());
    } else if (!refBillNo) {
      row.get('refBillDate')?.setValue(null);
    }
  }

  private fileKey(shipmentIndex: number, rowIndex: number): string {
    return `${shipmentIndex}:${rowIndex}`;
  }

  clickRefBillUpload(shipmentIndex: number, rowIndex: number): void {
    this.pendingUpload = { shipmentIndex, rowIndex };
    this.refBillDocInputRef?.nativeElement?.click();
  }

  onRefBillInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (file && this.pendingUpload) {
      const key = this.fileKey(this.pendingUpload.shipmentIndex, this.pendingUpload.rowIndex);
      this.refBillFiles.update((cur) => ({ ...cur, [key]: file }));
    }
    this.pendingUpload = null;
    input.value = '';
  }

  onPaymentCostingInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    const shipmentIndex = Number(input.dataset['shipmentIndex']);
    if (file && Number.isFinite(shipmentIndex)) {
      this.paymentCostingFiles.update((cur) => ({ ...cur, [shipmentIndex]: file }));
    }
    input.value = '';
    delete input.dataset['shipmentIndex'];
  }

  getRefBillFile(shipmentIndex: number, rowIndex: number): File | null {
    return this.refBillFiles()[this.fileKey(shipmentIndex, rowIndex)] ?? null;
  }

  clearRefBillFile(shipmentIndex: number, rowIndex: number): void {
    this.refBillFiles.update((cur) => ({ ...cur, [this.fileKey(shipmentIndex, rowIndex)]: null }));
  }

  getPaymentCostingFile(shipmentIndex: number): File | null {
    return this.paymentCostingFiles()[shipmentIndex] ?? null;
  }

  clearPaymentCostingFile(shipmentIndex: number): void {
    this.paymentCostingFiles.update((cur) => ({ ...cur, [shipmentIndex]: null }));
  }

  getSavedPaymentCostingUrl(group: AbstractControl): string {
    return (group as FormGroup).get('paymentCostingDocumentUrl')?.value || '';
  }

  getSavedPaymentCostingName(group: AbstractControl): string {
    return (group as FormGroup).get('paymentCostingDocumentName')?.value || '';
  }

  openRemoteDocumentPreview(url: string, title: string): void {
    this.previewUrl.set(url);
    this.previewTitle.set(title);
    this.previewIsImage.set(/\.(png|jpe?g|gif|webp)(\?|$)/i.test(url));
    this.resetPreviewZoom();
    this.showPreviewModal.set(true);
  }

  openDocumentPreview(file: File, title: string): void {
    this.previewUrl.set(URL.createObjectURL(file));
    this.previewTitle.set(title);
    this.previewIsImage.set(file.type.startsWith('image/'));
    this.resetPreviewZoom();
    this.showPreviewModal.set(true);
  }

  closeDocumentPreview(): void {
    const url = this.previewUrl();
    if (url) URL.revokeObjectURL(url);
    this.previewUrl.set(null);
    this.previewTitle.set('');
    this.resetPreviewZoom();
    this.showPreviewModal.set(false);
  }

  onPreviewVisibleChange(visible: boolean): void {
    if (!visible) this.closeDocumentPreview();
  }

  zoomInPreview(): void {
    this.previewZoom.update((zoom) => Math.min(zoom + 0.25, 4));
  }

  zoomOutPreview(): void {
    this.previewZoom.update((zoom) => Math.max(zoom - 0.25, 1));
  }

  resetPreviewZoom(): void {
    this.previewZoom.set(1);
    this.previewTransformOrigin.set('center center');
  }

  onPreviewImageDoubleClick(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    this.previewTransformOrigin.set(`${x}% ${y}%`);
    this.previewZoom.update((zoom) => (zoom > 1 ? 1 : 2));
  }

  saveAllocation(index: number): void {
    const group = this.formArray.at(index) as FormGroup | null;
    const shipmentId = this.shipmentData()?.shipment?._id;
    if (!group || !shipmentId) return;

    const containerId = group.get('containerId')?.value;
    if (!containerId) {
      this.notificationService.warn('Missing container', 'This shipment row is not linked to a container yet.');
      return;
    }

    const paymentAllocations = this.getPaymentAllocations(group).controls.map((row, rowIndex) => ({
      sn: Number(row.get('sn')?.value) || rowIndex + 1,
      description: row.get('description')?.value || '',
      requestAmount: Number(row.get('requestAmount')?.value) || 0,
      paidAmount: Number(row.get('paidAmount')?.value) || 0,
      reference: row.get('reference')?.value || '',
    }));

    const formData = new FormData();
    formData.append('paymentAllocations', JSON.stringify(paymentAllocations));

    this.savingRowIndex.set(index);
    this.shipmentService.submitPaymentCostingDetails(containerId, formData).subscribe({
      next: () => {
        this.savingRowIndex.set(null);
        this.notificationService.success('Saved', 'Payment allocation saved successfully.');
        this.store.dispatch(ShipmentActions.loadShipmentDetail({ id: shipmentId }));
      },
      error: (error) => {
        this.savingRowIndex.set(null);
        this.notificationService.error('Save failed', error.error?.message || 'Could not save payment allocation.');
      }
    });
  }

  saveCosting(index: number): void {
    const group = this.formArray.at(index) as FormGroup | null;
    const shipmentId = this.shipmentData()?.shipment?._id;
    if (!group || !shipmentId) return;

    const containerId = group.get('containerId')?.value;
    if (!containerId) {
      this.notificationService.warn('Missing container', 'This shipment row is not linked to a container yet.');
      return;
    }

    const toDate = (value: unknown) =>
      value ? new Date(value as string | Date).toISOString().split('T')[0] : '';

    const paymentCostings = this.getPaymentCostings(group).controls.map((row, rowIndex) => ({
      sn: Number(row.get('sn')?.value) || rowIndex + 1,
      description: row.get('description')?.value || '',
      requestAmount: Number(row.get('requestAmount')?.value) || 0,
      paidAmount: Number(row.get('paidAmount')?.value) || 0,
      actualPaid: Number(row.get('actualPaid')?.value) || 0,
      refBillNo: row.get('refBillNo')?.value || '',
      refBillDate: toDate(row.get('refBillDate')?.value),
      refBillVendor: row.get('refBillVendor')?.value || '',
      refBillDocumentUrl: row.get('refBillDocumentUrl')?.value || '',
      refBillDocumentName: row.get('refBillDocumentName')?.value || '',
    }));

    const packagingExpenses = this.getPackagingExpenses(group).controls.map((row, rowIndex) => ({
      sn: Number(row.get('sn')?.value) || rowIndex + 1,
      item: row.get('item')?.value || '',
      packing: row.get('packing')?.value || '',
      qty: Number(row.get('qty')?.value) || 0,
      uom: row.get('uom')?.value || '',
      unitCostFC: Number(row.get('unitCostFC')?.value) || 0,
      unitCostDH: Number(row.get('unitCostDH')?.value) || 0,
      totalCostFC: Number(row.get('totalCostFC')?.value) || 0,
      totalCostDH: Number(row.get('totalCostDH')?.value) || 0,
      expenseAllocationFactor: Number(row.get('expenseAllocationFactor')?.value) || 0,
      expensesAllocated: Number(row.get('expensesAllocated')?.value) || 0,
      totalValueWithExpenses: Number(row.get('totalValueWithExpenses')?.value) || 0,
      landedCostPerUnit: Number(row.get('landedCostPerUnit')?.value) || 0,
      reference: row.get('reference')?.value || '',
    }));

    const formData = new FormData();
    formData.append('paymentCostings', JSON.stringify(paymentCostings));
    formData.append('packagingExpenses', JSON.stringify(packagingExpenses));

    this.getPaymentCostings(group).controls.forEach((row, rowIndex) => {
      const refFile = this.getRefBillFile(index, rowIndex);
      if (refFile) {
        formData.append(`paymentCostings_${rowIndex}_refBill`, refFile, refFile.name);
      }
    });

    const overallFile = this.getPaymentCostingFile(index);
    if (overallFile) {
      formData.append('paymentCostingDocument', overallFile, overallFile.name);
    }

    this.savingRowIndex.set(index);
    this.shipmentService.submitPaymentCostingDetails(containerId, formData).subscribe({
      next: () => {
        this.savingRowIndex.set(null);
        this.notificationService.success('Saved', 'Payment costing details saved successfully.');
        this.store.dispatch(ShipmentActions.loadShipmentDetail({ id: shipmentId }));
      },
      error: (error) => {
        this.savingRowIndex.set(null);
        this.notificationService.error('Save failed', error.error?.message || 'Could not save payment costing details.');
      }
    });
  }

  generateAllocationReport(index: number): void {
    const group = this.formArray.at(index) as FormGroup | null;
    if (!group) return;
    const shipmentNo = this.getShipmentNoLabel(index);
    const shipment = this.shipmentData()?.shipment;
    const metadataRows: [string, string][] = [
      ['Shipment No', shipmentNo],
      ['Supplier', shipment?.supplier || ''],
      ['PO No', shipment?.poNumber || ''],
      ['PI No', shipment?.piNo || ''],
      ['Incoterms', shipment?.incoterms || ''],
      ['Payment Terms', shipment?.paymentTerms || ''],
    ];
    this.downloadCostingSheetPdf({
      shipmentNo,
      metadataRows,
      clearingRows: this.getPaymentAllocations(group).controls.map((row) => ({
        sn: row.get('sn')?.value ?? '',
        description: row.get('description')?.value ?? '',
        requestAmount: this.formatCurrency(row.get('requestAmount')?.value ?? 0),
        paidAmount: this.formatCurrency(row.get('paidAmount')?.value ?? 0),
        actualAmount: '0.00',
        remarks: row.get('reference')?.value ?? '',
      })),
    });
  }

  generateReport(index: number): void {
    const group = this.formArray.at(index) as FormGroup | null;
    if (!group) return;

    const shipmentNo = this.getShipmentNoLabel(index);
    const shipment = this.shipmentData()?.shipment;
    const firstCostingRow = this.getPaymentCostings(group).at(0) as FormGroup | null;
    const metadataRows: [string, string][] = [
      ['Shipment No', shipmentNo],
      ['Supplier', shipment?.supplier || ''],
      ['PO No', shipment?.poNumber || ''],
      ['PI No', shipment?.piNo || ''],
      ['Incoterms', shipment?.incoterms || ''],
      ['Payment Terms', shipment?.paymentTerms || ''],
      ['Ref Bill No', firstCostingRow?.get('refBillNo')?.value || ''],
      ['Ref Bill Date', this.formatDateForReport(firstCostingRow?.get('refBillDate')?.value)],
      ['Ref Bill Vendor', firstCostingRow?.get('refBillVendor')?.value || ''],
    ];
    this.downloadCostingSheetPdf({
      shipmentNo,
      metadataRows,
      clearingRows: this.getPaymentCostings(group).controls.map((row) => ({
        sn: row.get('sn')?.value ?? '',
        description: row.get('description')?.value ?? '',
        requestAmount: this.formatCurrency(row.get('requestAmount')?.value ?? 0),
        paidAmount: this.formatCurrency(row.get('paidAmount')?.value ?? 0),
        actualAmount: this.formatCurrency(row.get('actualPaid')?.value ?? 0),
        remarks: [row.get('refBillNo')?.value, this.formatDateForReport(row.get('refBillDate')?.value), row.get('refBillVendor')?.value]
          .filter(Boolean)
          .join(' / '),
      })),
      packagingRows: this.getPackagingExpenses(group).controls.map((row) => ({
        sn: row.get('sn')?.value ?? '',
        item: row.get('item')?.value ?? '',
        packing: row.get('packing')?.value ?? '',
        qty: this.formatCurrency(row.get('qty')?.value ?? 0),
        uom: row.get('uom')?.value ?? '',
        unitCostFC: this.formatCurrency(row.get('unitCostFC')?.value ?? 0),
        unitCostDH: this.formatCurrency(row.get('unitCostDH')?.value ?? 0),
        totalCostFC: this.formatCurrency(row.get('totalCostFC')?.value ?? 0),
        totalCostDH: this.formatCurrency(row.get('totalCostDH')?.value ?? 0),
        expenseAllocationFactor: this.formatCurrency(row.get('expenseAllocationFactor')?.value ?? 0),
        expensesAllocated: this.formatCurrency(row.get('expensesAllocated')?.value ?? 0),
        totalValueWithExpenses: this.formatCurrency(row.get('totalValueWithExpenses')?.value ?? 0),
        landedCostPerUnit: this.formatCurrency(row.get('landedCostPerUnit')?.value ?? 0),
        reference: row.get('reference')?.value ?? '',
      })),
    });
  }

  getAllocationTotal(group: AbstractControl, field: 'requestAmount' | 'paidAmount'): string {
    return this.sumFormArrayField(this.getPaymentAllocations(group), field);
  }

  getPaymentCostingTotal(group: AbstractControl, field: 'requestAmount' | 'paidAmount' | 'actualPaid'): string {
    return this.sumFormArrayField(this.getPaymentCostings(group), field);
  }

  getPackagingExpenseTotal(
    group: AbstractControl,
    field:
      | 'qty'
      | 'unitCostFC'
      | 'unitCostDH'
      | 'totalCostFC'
      | 'totalCostDH'
      | 'expenseAllocationFactor'
      | 'expensesAllocated'
      | 'totalValueWithExpenses'
      | 'landedCostPerUnit'
  ): string {
    return this.sumFormArrayField(this.getPackagingExpenses(group), field);
  }

  private sumFormArrayField(formArray: FormArray, field: string): string {
    const total = formArray.controls.reduce((sum, row) => sum + (Number(row.get(field)?.value) || 0), 0);
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(total);
  }

}
