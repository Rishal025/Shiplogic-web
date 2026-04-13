import { Component, Input, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormArray, ReactiveFormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { NotificationService } from '../../../../../../core/services/notification.service';
import { ShipmentService } from '../../../../../../core/services/shipment.service';
import * as ShipmentActions from '../../../../../../store/shipment/shipment.actions';
import { AccordionModule } from 'primeng/accordion';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectButtonModule } from 'primeng/selectbutton';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TabsModule } from 'primeng/tabs';
import { DialogModule } from 'primeng/dialog';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  selectIsPlannedLocked,
  selectShipmentData,
  selectSubmittedActualIndices,
  selectSubmittedStep3Indices,
  selectSubmittedStep4Indices,
  selectSubmittedStep5Indices,
  selectSubmittedStep6Indices,
  selectSubmittedStep7Indices,
} from '../../../../../../store/shipment/shipment.selectors';

const COST_SHEET_DESCRIPTIONS = [
  'Invoice Attestation - MOFAIC',
  'DC Charges',
  'DO Extension',
  'Air Cargo Clearing Charge',
  'Labour Charges',
  'Other Charges',
  'BOE',
  'Custom Duty 5%',
  'Custom Pay Service Charges',
  'DP Charges',
  'TLUC',
  'THC',
  'DP Storage Charges 01',
  'DP Storage Charges 02',
  'Mun Charges',
  'Addi Gate Token',
  'DP Gate Token',
  'Transportation Single @rate (ALAIN)',
  'Transportation Single @rate (AD)',
  'Transportation Single/Couple @rate (DIC)',
  'Transportation Single/Couple @rate (Location)',
  'Inspection Charges 01',
  'Inspection Charges 02',
  'Offloading Charges 01',
  'Offloading Charges 02',
  'Mecrec Charges',
  'Open & Close Fees with Sales at Customs',
  'Other',
  'Murabaha Profit',
] as const;

@Component({
  selector: 'app-shipment-bl-details',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    AccordionModule,
    DatePickerModule,
    InputNumberModule,
    InputTextModule,
    SelectButtonModule,
    SelectModule,
    ToggleSwitchModule,
    TabsModule,
    DialogModule,
  ],
  templateUrl: './shipment-bl-details.component.html',
})
export class ShipmentBlDetailsComponent {
  @Input({ required: true }) formArray!: FormArray;

  private sanitizer = inject(DomSanitizer);
  private store = inject(Store);
  private shipmentService = inject(ShipmentService);
  private notificationService = inject(NotificationService);

  readonly shipmentData = toSignal(this.store.select(selectShipmentData));
  readonly isPlannedLocked = toSignal(this.store.select(selectIsPlannedLocked), { initialValue: false });
  readonly submittedActualIndices = toSignal(this.store.select(selectSubmittedActualIndices), { initialValue: [] });
  readonly submittedStep3Indices = toSignal(this.store.select(selectSubmittedStep3Indices), { initialValue: [] });
  readonly submittedStep4Indices = toSignal(this.store.select(selectSubmittedStep4Indices), { initialValue: [] });
  readonly submittedStep5Indices = toSignal(this.store.select(selectSubmittedStep5Indices), { initialValue: [] });
  readonly submittedStep6Indices = toSignal(this.store.select(selectSubmittedStep6Indices), { initialValue: [] });
  readonly submittedStep7Indices = toSignal(this.store.select(selectSubmittedStep7Indices), { initialValue: [] });

  readonly warehouseOptions = [
    { label: 'Warehouse DIC - RH006', value: 'Warehouse DIC - RH006' },
    { label: 'Warehouse Musaffah- RH001P1', value: 'Warehouse Musaffah- RH001P1' },
  ];
  readonly costSheetDescriptions = COST_SHEET_DESCRIPTIONS;

  readonly activeTabs = signal<Record<number, 'cost' | 'storage' | 'packaging'>>({});
  readonly expandedCostSheet = signal<Record<number, boolean>>({});
  readonly bookingFiles = signal<Record<number, File | null>>({});
  readonly statusModalVisible = signal(false);
  readonly statusModalShipmentIndex = signal<number | null>(null);
  readonly savingKey = signal<string | null>(null);
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

  constructor() {
    effect(() => {
      this.formArray?.controls.forEach((_, index) => {
        if (!this.activeTabs()[index]) {
          this.activeTabs.update((current) => ({ ...current, [index]: 'cost' }));
        }
        if (this.expandedCostSheet()[index] == null) {
          this.expandedCostSheet.update((current) => ({ ...current, [index]: false }));
        }
      });
    });
  }

  getShipmentNoLabel(index: number): string {
    if (this.formArray?.controls[index] == null) return '–';
    const base = this.shipmentData()?.shipment?.shipmentNo?.replace(/\([^)]*\)/g, '').trim();
    return base?.trim() ? `${base}-${index + 1}` : '–';
  }

  setActiveTab(index: number, tab: 'cost' | 'storage' | 'packaging'): void {
    this.activeTabs.update((current) => ({ ...current, [index]: tab }));
  }

  getActiveTab(index: number): 'cost' | 'storage' | 'packaging' {
    return this.activeTabs()[index] ?? 'cost';
  }

  getCostSheetRows(group: AbstractControl): FormArray {
    return group.get('costSheetBookings') as FormArray;
  }

  getStorageRows(group: AbstractControl): FormArray {
    return group.get('storageAllocations') as FormArray;
  }

  getVisibleCostSheetRows(group: AbstractControl, shipmentIndex: number): AbstractControl[] {
    const rows = this.getCostSheetRows(group).controls;
    return this.expandedCostSheet()[shipmentIndex] ? rows : rows.slice(0, 5);
  }

  hasHiddenCostSheetRows(group: AbstractControl, shipmentIndex: number): boolean {
    return !this.expandedCostSheet()[shipmentIndex] && this.getCostSheetRows(group).length > 5;
  }

  toggleCostSheetRows(shipmentIndex: number): void {
    this.expandedCostSheet.update((current) => ({
      ...current,
      [shipmentIndex]: !current[shipmentIndex],
    }));
  }

  onBookingFileSelected(event: Event, shipmentIndex: number): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;

    this.bookingFiles.update((current) => ({ ...current, [shipmentIndex]: file }));
    input.value = '';
  }

  getBookingFile(shipmentIndex: number): File | null {
    return this.bookingFiles()[shipmentIndex] ?? null;
  }

  clearBookingFile(shipmentIndex: number): void {
    this.bookingFiles.update((current) => ({ ...current, [shipmentIndex]: null }));
  }

  getSavedBookingUrl(group: AbstractControl): string {
    return group.get('costSheetBookingDocumentUrl')?.value || '';
  }

  getSavedBookingName(group: AbstractControl): string {
    return group.get('costSheetBookingDocumentName')?.value || '';
  }

  getSavedBlDocumentUrl(group: AbstractControl): string {
    return group.get('blDocumentUrl')?.value || '';
  }

  getSavedBlDocumentName(group: AbstractControl): string {
    return group.get('blDocumentName')?.value || '';
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

    doc.save(`${config.shipmentNo.replace(/[^a-z0-9_-]/gi, '_')}-costing-sheet.pdf`);
  }

  openRemoteDocumentPreview(url: string, title: string): void {
    this.previewUrl.set(url);
    this.previewTitle.set(title);
    this.previewIsImage.set(/\.(png|jpe?g|gif|webp)(\?|$)/i.test(url));
    this.resetPreviewZoom();
    this.showPreviewModal.set(true);
  }

  openDocumentPreview(file: File, title: string): void {
    const url = URL.createObjectURL(file);
    this.previewUrl.set(url);
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

  openStatusModal(index: number): void {
    this.statusModalShipmentIndex.set(index);
    this.statusModalVisible.set(true);
  }

  isSaving(index: number, section: 'bl' | 'cost' | 'storage'): boolean {
    return this.savingKey() === `${section}-${index}`;
  }

  saveBLDetails(index: number): void {
    const row = this.formArray.at(index);
    const shipmentId = this.shipmentData()?.shipment?._id;
    if (!row || !shipmentId) return;

    const containerId = row.get('containerId')?.value;
    if (!containerId) {
      this.notificationService.warn('Missing container', 'This shipment row is not linked to a container yet.');
      return;
    }

    const toDate = (value: unknown) =>
      value ? new Date(value as string | Date).toISOString().split('T')[0] : '';

    this.savingKey.set(`bl-${index}`);
    const formData = new FormData();
    formData.append('blNo', row.get('blNo')?.value || '');
    formData.append('shippedOnBoard', toDate(row.get('shippedOnBoard')?.value));
    formData.append('portOfLoading', row.get('portOfLoading')?.value || '');
    formData.append('portOfDischarge', row.get('portOfDischarge')?.value || '');
    formData.append('noOfContainers', String(Number(row.get('noOfContainers')?.value) || 0));
    formData.append('noOfBags', String(Number(row.get('noOfBags')?.value) || 0));
    formData.append('quantityByMt', String(Number(row.get('quantityByMt')?.value) || 0));
    formData.append('shippingLine', row.get('shippingLine')?.value || '');
    formData.append('freeDetentionDays', String(Number(row.get('freeDetentionDays')?.value) || 0));
    formData.append('maximumDetentionDays', String(Number(row.get('maximumDetentionDays')?.value) || 0));
    formData.append('freightPrepared', row.get('freightPrepared')?.value || 'No');

    formData.append('actualBags', String(Number(row.get('actualBags')?.value) || 0));
    formData.append('expiryDate', toDate(row.get('expiryDate')?.value));
    formData.append('hsCode', row.get('hsCode')?.value || '');
    formData.append('packagingDate', toDate(row.get('packagingDate')?.value));
    formData.append('grossWeight', row.get('grossWeight')?.value || '');
    formData.append('netWeight', row.get('netWeight')?.value || '');

    this.shipmentService.submitBLDetails(containerId, formData).subscribe({
      next: () => {
        this.savingKey.set(null);
        this.notificationService.success('Saved', 'B/L details saved successfully.');
        this.store.dispatch(ShipmentActions.loadShipmentDetail({ id: shipmentId }));
      },
      error: (error) => {
        this.savingKey.set(null);
        this.notificationService.error('Save failed', error.error?.message || 'Could not save B/L details.');
      }
    });
  }

  saveCostSheet(index: number): void {
    const row = this.formArray.at(index);
    const shipmentId = this.shipmentData()?.shipment?._id;
    if (!row || !shipmentId) return;

    const containerId = row.get('containerId')?.value;
    if (!containerId) {
      this.notificationService.warn('Missing container', 'This shipment row is not linked to a container yet.');
      return;
    }

    const costSheetBookings = this.getCostSheetRows(row).getRawValue().map((entry: any) => ({
      sn: Number(entry.sn) || 0,
      description: entry.description || '',
      requestAmount: Number(entry.requestAmount ?? 0),
      paidAmount: Number(entry.paidAmount ?? 0),
    }));

    this.savingKey.set(`cost-${index}`);
    const formData = new FormData();
    formData.append('costSheetBookings', JSON.stringify(costSheetBookings));

    const bookingFile = this.getBookingFile(index);
    if (bookingFile) {
      formData.append('costSheetBookingDocument', bookingFile, bookingFile.name);
    }

    this.shipmentService.submitBLDetails(containerId, formData).subscribe({
      next: () => {
        this.savingKey.set(null);
        if (bookingFile) this.clearBookingFile(index);
        this.notificationService.success('Saved', 'Cost sheet booking saved successfully.');
        this.store.dispatch(ShipmentActions.loadShipmentDetail({ id: shipmentId }));
      },
      error: (error) => {
        this.savingKey.set(null);
        this.notificationService.error('Save failed', error.error?.message || 'Could not save cost sheet booking.');
      }
    });
  }

  saveStorageAllocations(index: number): void {
    const row = this.formArray.at(index);
    const shipmentId = this.shipmentData()?.shipment?._id;
    if (!row || !shipmentId) return;

    const containerId = row.get('containerId')?.value;
    if (!containerId) {
      this.notificationService.warn('Missing container', 'This shipment row is not linked to a container yet.');
      return;
    }

    const storageAllocations = this.getStorageRows(row).getRawValue().map((entry: any) => ({
      sn: Number(entry.sn) || 0,
      containerSerialNo: entry.containerSerialNo || '',
      bags: Number(entry.bags ?? 0) || 0,
      warehouse: entry.warehouse || '',
      storageAvailability: Number(entry.storageAvailability) || 0,
    }));

    this.savingKey.set(`storage-${index}`);
    const formData = new FormData();
    formData.append('storageAllocations', JSON.stringify(storageAllocations));

    this.shipmentService.submitBLDetails(containerId, formData).subscribe({
      next: () => {
        this.savingKey.set(null);
        this.notificationService.success('Saved', 'Storage allocations saved successfully.');
        this.store.dispatch(ShipmentActions.loadShipmentDetail({ id: shipmentId }));
      },
      error: (error) => {
        this.savingKey.set(null);
        this.notificationService.error('Save failed', error.error?.message || 'Could not save storage allocations.');
      }
    });
  }

  generateCostSheetReport(index: number): void {
    const row = this.formArray.at(index);
    if (!row) return;

    const rows = this.getCostSheetRows(row).getRawValue();
    const shipment = this.shipmentData()?.shipment;
    const metadataRows: [string, string][] = [
      ['Shipment No', this.getShipmentNoLabel(index)],
      ['Supplier', shipment?.supplier || ''],
      ['PO No', shipment?.poNumber || ''],
      ['PI No', shipment?.piNo || ''],
      ['Incoterms', shipment?.incoterms || ''],
      ['Payment Terms', shipment?.paymentTerms || ''],
      ['BL No', row.get('blNo')?.value || ''],
      ['Port Of Loading', row.get('portOfLoading')?.value || ''],
      ['Port Of Discharge', row.get('portOfDischarge')?.value || ''],
      ['No Of Containers', this.formatCurrency(row.get('noOfContainers')?.value ?? 0)],
      ['Quantity By MT', this.formatCurrency(row.get('quantityByMt')?.value ?? 0)],
      ['Shipped On Board', this.formatDateForReport(row.get('shippedOnBoard')?.value)],
    ];
    this.downloadCostingSheetPdf({
      shipmentNo: this.getShipmentNoLabel(index),
      metadataRows,
      clearingRows: rows.map((entry: any) => ({
        sn: Number(entry.sn) || 0,
        description: entry.description || '',
        requestAmount: this.formatCurrency(entry.requestAmount ?? 0),
        paidAmount: this.formatCurrency(entry.paidAmount ?? 0),
        actualAmount: '0.00',
        remarks: '',
      })),
    });
  }

  getCostSheetTotal(group: AbstractControl, field: 'requestAmount' | 'paidAmount'): string {
    const total = this.getCostSheetRows(group)
      .getRawValue()
      .reduce((sum: number, row: any) => sum + (Number(row?.[field]) || 0), 0);
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(total);
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
}
