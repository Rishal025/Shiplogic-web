import { Component, Input, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormArray, ReactiveFormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { NotificationService } from '../../../../../../core/services/notification.service';
import { ShipmentService } from '../../../../../../core/services/shipment.service';
import { WarehouseService } from '../../../../../../core/services/warehouse.service';
import { ConfirmDialogService } from '../../../../../../core/services/confirm-dialog.service';
import { AuthService } from '../../../../../../core/services/auth.service';
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
  styleUrl: './shipment-bl-details.component.scss',
})
export class ShipmentBlDetailsComponent {
  @Input({ required: true }) formArray!: FormArray;

  private sanitizer = inject(DomSanitizer);
  private store = inject(Store);
  private shipmentService = inject(ShipmentService);
  private warehouseService = inject(WarehouseService);
  private notificationService = inject(NotificationService);
  private confirmDialog = inject(ConfirmDialogService);
  private authService = inject(AuthService);

  readonly shipmentData = toSignal(this.store.select(selectShipmentData));
  readonly isPlannedLocked = toSignal(this.store.select(selectIsPlannedLocked), { initialValue: false });
  readonly submittedActualIndices = toSignal(this.store.select(selectSubmittedActualIndices), { initialValue: [] });
  readonly submittedStep3Indices = toSignal(this.store.select(selectSubmittedStep3Indices), { initialValue: [] });
  readonly submittedStep4Indices = toSignal(this.store.select(selectSubmittedStep4Indices), { initialValue: [] });
  readonly submittedStep5Indices = toSignal(this.store.select(selectSubmittedStep5Indices), { initialValue: [] });
  readonly submittedStep6Indices = toSignal(this.store.select(selectSubmittedStep6Indices), { initialValue: [] });
  readonly submittedStep7Indices = toSignal(this.store.select(selectSubmittedStep7Indices), { initialValue: [] });

  readonly warehouseOptions = signal<Array<{ label: string; value: string }>>([]);
  readonly costSheetSearchTerm = signal<Record<number, string>>({});
  readonly editingCostSheet = signal<Record<number, boolean>>({});
  readonly costSheetDescriptions = COST_SHEET_DESCRIPTIONS;

  readonly activeTabs = signal<Record<number, 'cost' | 'storage' | 'packaging'>>({});
  readonly expandedCostSheet = signal<Record<number, boolean>>({});
  readonly bookingFiles = signal<Record<number, File | null>>({});
  readonly statusModalVisible = signal(false);
  readonly statusModalShipmentIndex = signal<number | null>(null);
  readonly savingKey = signal<string | null>(null);
  readonly storageValidationModalVisible = signal(false);
  readonly storageValidationMessage = signal('');
  readonly storageValidationDetails = signal<Array<{ storage: string; packaging: string }>>([]);
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
    this.warehouseService.getWarehouses().subscribe({
      next: (warehouses) => {
        const activeWarehouses = warehouses
          .filter((warehouse) => warehouse.status === 'Active')
          .map((warehouse) => {
            const codeSuffix = warehouse.code ? ` - ${warehouse.code}` : '';
            const label = `${warehouse.name}${codeSuffix}`;
            return { label, value: label };
          });
        this.warehouseOptions.set(activeWarehouses);
      },
    });

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

  isCostSheetSaved(index: number): boolean {
    const shipment = this.shipmentData()?.actual?.[index];
    if (!shipment) return false;
    const rows = shipment.costSheetBookings || [];
    return rows.some((entry: any) => Number(entry?.requestAmount || 0) > 0 || Number(entry?.paidAmount || 0) > 0);
  }

  isCostSheetEditing(index: number): boolean {
    if (this.editingCostSheet()[index]) return true;
    return !this.isCostSheetSaved(index);
  }

  enableCostSheetEdit(index: number): void {
    this.editingCostSheet.update((current) => ({ ...current, [index]: true }));
  }

  cancelCostSheetEdit(index: number): void {
    this.editingCostSheet.update((current) => ({ ...current, [index]: false }));
    const shipmentId = this.shipmentData()?.shipment?._id;
    if (shipmentId) {
      this.store.dispatch(ShipmentActions.loadShipmentDetail({ id: shipmentId }));
    }
  }

  setCostSheetSearchTerm(index: number, term: string): void {
    this.costSheetSearchTerm.update((current) => ({ ...current, [index]: term }));
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

  private normalizeContainerNumber(value: unknown): string {
    return String(value ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .trim();
  }

  private isCloseContainerMismatch(left: string, right: string): boolean {
    if (!left || !right || left === right || left.length !== right.length) {
      return false;
    }

    let diffCount = 0;
    for (let index = 0; index < left.length; index++) {
      if (left[index] !== right[index]) {
        diffCount += 1;
        if (diffCount > 1) return false;
      }
    }

    return diffCount === 1;
  }

  private getPackagingContainerEntries(group: AbstractControl): Array<{ raw: string; normalized: string }> {
    const packagingList = group.get('packagingList')?.value;
    const containerInfo =
      packagingList?.containerInfo ||
      packagingList?.container_info ||
      [];
    const containerNumberList = packagingList?.container_number_list || [];
    const extractedContainers = group.get('extractedContainers')?.value || [];

    const entrySource = Array.isArray(containerInfo) && containerInfo.length
      ? containerInfo
      : Array.isArray(containerNumberList) && containerNumberList.length
        ? containerNumberList
        : extractedContainers;

    return entrySource
      .map((entry: any) => {
        const raw = typeof entry === 'string'
          ? entry.trim()
          : String(
              entry?.container_number ||
              entry?.containerNo ||
              entry?.container_no ||
              entry?.containerNumber ||
              ''
            ).trim();
        return { raw, normalized: this.normalizeContainerNumber(raw) };
      })
      .filter((entry: { raw: string; normalized: string }) => !!entry.normalized);
  }

  private getStorageContainerEntries(group: AbstractControl): Array<{ raw: string; normalized: string }> {
    return this.getStorageRows(group)
      .getRawValue()
      .map((entry: any) => {
        const raw = String(entry?.containerSerialNo || '').trim();
        return { raw, normalized: this.normalizeContainerNumber(raw) };
      })
      .filter((entry: { raw: string; normalized: string }) => !!entry.normalized);
  }

  private getStorageContainerValidationState(group: AbstractControl): {
    valid: boolean;
    message: string;
    mismatches: Array<{ storage: string; packaging: string }>;
    warnings: Array<{ storage: string; packaging: string }>;
  } {
    const packagingEntries = this.getPackagingContainerEntries(group);
    const storageEntries = this.getStorageContainerEntries(group);

    if (!packagingEntries.length || !storageEntries.length) {
      return {
        valid: false,
        message: 'Container names are required in both Packaging List and Storage Allocations before saving.',
        mismatches: [],
        warnings: [],
      };
    }

    if (packagingEntries.length !== storageEntries.length) {
      return {
        valid: false,
        message: `Container count mismatch: Packaging List has ${packagingEntries.length}, while Storage Allocations has ${storageEntries.length}. Please update the container rows before saving.`,
        mismatches: [],
        warnings: [],
      };
    }

    const mismatches: Array<{ storage: string; packaging: string }> = [];
    const warnings: Array<{ storage: string; packaging: string }> = [];

    for (let index = 0; index < packagingEntries.length; index++) {
      const packagingEntry = packagingEntries[index];
      const storageEntry = storageEntries[index];

      if (packagingEntry.normalized === storageEntry.normalized) {
        continue;
      }

      const mismatch = {
        storage: storageEntry.raw || '—',
        packaging: packagingEntry.raw || '—',
      };

      mismatches.push(mismatch);

      if (this.isCloseContainerMismatch(storageEntry.normalized, packagingEntry.normalized)) {
        warnings.push(mismatch);
      }
    }

    if (!mismatches.length) {
      return { valid: true, message: '', mismatches: [], warnings: [] };
    }

    return {
      valid: false,
      message: 'Storage Allocation container names do not match the Packaging List. Please update the container names before saving.',
      mismatches,
      warnings,
    };
  }

  getStorageCloseMismatchWarnings(group: AbstractControl): Array<{ storage: string; packaging: string }> {
    return this.getStorageContainerValidationState(group).warnings;
  }

  getStorageContainerMismatches(group: AbstractControl): Array<{ storage: string; packaging: string }> {
    return this.getStorageContainerValidationState(group).mismatches;
  }

  getStorageRowMismatch(
    group: AbstractControl,
    rowIndex: number
  ): { storage: string; packaging: string } | null {
    return this.getStorageContainerValidationState(group).mismatches[rowIndex] ?? null;
  }

  private validateStorageAllocationContainers(group: AbstractControl): {
    valid: boolean;
    message: string;
    mismatches: Array<{ storage: string; packaging: string }>;
  } {
    const state = this.getStorageContainerValidationState(group);
    return {
      valid: state.valid,
      message: state.message,
      mismatches: state.mismatches,
    };
  }

  closeStorageValidationModal(): void {
    this.storageValidationModalVisible.set(false);
    this.storageValidationMessage.set('');
    this.storageValidationDetails.set([]);
  }

  getVisibleCostSheetRows(group: AbstractControl, shipmentIndex: number): AbstractControl[] {
    const rows = this.getCostSheetRows(group).controls;
    const term = String(this.costSheetSearchTerm()[shipmentIndex] || '').trim().toLowerCase();
    const filteredRows = term
      ? rows.filter((row) => String(row.get('description')?.value || '').toLowerCase().includes(term))
      : rows;
    return this.expandedCostSheet()[shipmentIndex] ? filteredRows : filteredRows.slice(0, 5);
  }

  hasHiddenCostSheetRows(group: AbstractControl, shipmentIndex: number): boolean {
    const term = String(this.costSheetSearchTerm()[shipmentIndex] || '').trim().toLowerCase();
    const total = term
      ? this.getCostSheetRows(group).controls.filter((row) =>
          String(row.get('description')?.value || '').toLowerCase().includes(term)
        ).length
      : this.getCostSheetRows(group).length;
    return !this.expandedCostSheet()[shipmentIndex] && total > 5;
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
    date: string;
    csNo: string;
    vendor: string;
    country: string;
    invoiceAmountFC: string;
    exchangeRate: string;
    invoiceAmountAED: string;
    incoTerms: string;
    paymentTerms: string;
    comInv: string;
    profNo: string;
    murabahaNo: string;
    shipmentNo2: string;
    shippingLine: string;
    blNo: string;
    noOfContainers: string;
    loadingPort: string;
    despatchPort: string;
    arrivedAtPort: string;
    arrivedAtWH: string;
    noOfDaysAtPort: string;
    grvNo: string;
    decNo: string;
    decValue: string;
    downloadedBy: string;
    costRows: Array<{ sn: number | string; description: string; requestAmount: string; actualCostDH: string; billRef: string; remarks: string }>;
    itemRows: Array<{
      slNo: number | string; item: string; packing: string; qty: string; uom: string;
      unitCostFC: string; unitCostDH: string; totalCostFC: string; totalCostDH: string;
      allocationFactor: string; expensesAllocated: string; totalValueWithExpenses: string; landedCostPerUnit: string;
    }>;
  }): void {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 36;
    const contentW = pageW - margin * 2;

    // ── HEADER ──────────────────────────────────────────────────────────────
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('ROYAL HORIZON GENERAL TRADING', margin, 44);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('COSTING SHEET', margin, 58);

    // Date / CS No box (top right)
    const boxW = 130;
    const boxX = pageW - margin - boxW;
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.rect(boxX, 30, boxW, 34);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('Date:', boxX + 6, 43);
    doc.text('CS No:', boxX + 6, 57);
    doc.setFont('helvetica', 'normal');
    doc.text(config.date, boxX + 36, 43);
    doc.text(config.csNo, boxX + 36, 57);

    doc.setLineWidth(1);
    doc.line(margin, 68, pageW - margin, 68);

    // ── SECTION 1: IMPORT / INVOICE DETAILS ─────────────────────────────────
    let y = 80;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('SECTION 1: IMPORT / INVOICE DETAILS', margin, y);
    y += 8;

    const colW = contentW / 2 - 4;
    const leftX = margin;
    const rightX = margin + colW + 8;
    const rowH = 14;

    const leftFields: [string, string][] = [
      ['Vendor', config.vendor],
      ['Country', config.country],
      ['Invoice Amount FC', config.invoiceAmountFC],
      ['Exchange Rate', config.exchangeRate],
      ['Invoice Amount AED', config.invoiceAmountAED],
      ['Inco Terms', config.incoTerms],
      ['Payment Terms', config.paymentTerms],
      ['Com Inv', config.comInv],
      ['Prof No', config.profNo],
      ['Murabaha / TT No', config.murabahaNo],
    ];

    const rightFields: [string, string][] = [
      ['Shipment No', config.shipmentNo2],
      ['Shipping Line', config.shippingLine],
      ['BL No', config.blNo],
      ['No of Containers', config.noOfContainers],
      ['Loading Port', config.loadingPort],
      ['Despatch Port', config.despatchPort],
      ['Arrived at Port', config.arrivedAtPort],
      ['Arrived at WH', config.arrivedAtWH],
      ['No of Days at Port', config.noOfDaysAtPort],
      ['GRV No', config.grvNo],
      ['Dec No', config.decNo],
      ['Dec Value', config.decValue],
    ];

    const maxRows = Math.max(leftFields.length, rightFields.length);
    const tableTop = y + 2;
    const tableH = (maxRows + 1) * rowH + 4;

    doc.setLineWidth(0.4);
    doc.rect(leftX, tableTop, colW, tableH);
    doc.rect(rightX, tableTop, colW, tableH);

    // Headers
    doc.setFillColor(30, 41, 59);
    doc.rect(leftX, tableTop, colW, rowH, 'F');
    doc.rect(rightX, tableTop, colW, rowH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255);
    doc.text('FIELD', leftX + 4, tableTop + rowH - 3);
    doc.text('VALUE', leftX + colW * 0.52, tableTop + rowH - 3);
    doc.text('FIELD', rightX + 4, tableTop + rowH - 3);
    doc.text('VALUE', rightX + colW * 0.52, tableTop + rowH - 3);
    doc.setTextColor(0);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);

    for (let i = 0; i < maxRows; i++) {
      const rowY = tableTop + (i + 1) * rowH;
      if (i % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(leftX, rowY, colW, rowH, 'F');
        doc.rect(rightX, rowY, colW, rowH, 'F');
      }
      doc.setLineWidth(0.2);
      doc.line(leftX, rowY, leftX + colW, rowY);
      doc.line(rightX, rowY, rightX + colW, rowY);

      if (leftFields[i]) {
        doc.setFont('helvetica', 'bold');
        doc.text(leftFields[i][0], leftX + 4, rowY + rowH - 3);
        doc.setFont('helvetica', 'normal');
        doc.text(leftFields[i][1] || '—', leftX + colW * 0.52, rowY + rowH - 3);
      }
      if (rightFields[i]) {
        doc.setFont('helvetica', 'bold');
        doc.text(rightFields[i][0], rightX + 4, rowY + rowH - 3);
        doc.setFont('helvetica', 'normal');
        doc.text(rightFields[i][1] || '—', rightX + colW * 0.52, rowY + rowH - 3);
      }
    }

    y = tableTop + tableH + 14;

    // ── SECTION 2: COST BREAKDOWN ────────────────────────────────────────────
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('SECTION 2: COST BREAKDOWN', margin, y);
    y += 4;

    const costTotal = config.costRows.reduce((s, r) => s + (Number(r.actualCostDH) || 0), 0);
    const requestTotal = config.costRows.reduce((s, r) => s + (Number(r.requestAmount) || 0), 0);
    const costBody: any[][] = config.costRows.map((r) => [r.sn, r.description, r.requestAmount, r.actualCostDH, r.billRef || '', r.remarks || '']);
    costBody.push(['', 'TOTAL', this.formatCurrency(requestTotal), this.formatCurrency(costTotal), '', '']);

    autoTable(doc, {
      startY: y,
      head: [['SN', 'Description', 'Request Amount', 'Actual Cost (DH)', 'Bill Ref.', 'Payment Ref / Remarks']],
      body: costBody,
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 3 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 160 },
        2: { halign: 'right', cellWidth: 72 },
        3: { halign: 'right', cellWidth: 72 },
        4: { cellWidth: 72 },
        5: { cellWidth: 'auto' },
      },
      didParseCell: (data: any) => {
        if (data.row.index === costBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [241, 245, 249];
        }
      },
      margin: { left: margin, right: margin },
    });

    y = (doc as any).lastAutoTable.finalY + 14;

    // ── SECTION 3: ITEM COSTING ──────────────────────────────────────────────
    if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 40; }

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('SECTION 3: ITEM COSTING', margin, y);
    y += 4;

    const itemBody = config.itemRows.map((r) => [
      r.slNo, r.item, r.packing, r.qty, r.uom,
      r.unitCostFC, r.unitCostDH, r.totalCostFC, r.totalCostDH,
      r.allocationFactor, r.expensesAllocated, r.totalValueWithExpenses, r.landedCostPerUnit,
    ]);

    autoTable(doc, {
      startY: y,
      head: [['Sl No', 'Item', 'Packing', 'Qty', 'UOM', 'Unit Cost FC', 'Unit Cost DH', 'Total Cost FC', 'Total Cost DH', 'Alloc. Factor', 'Exp. Allocated', 'Total w/ Exp.', 'Landed Cost/Unit']],
      body: itemBody.length ? itemBody : [['—', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—']],
      theme: 'grid',
      styles: { fontSize: 6.5, cellPadding: 2.5 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', fontSize: 6.5 },
      columnStyles: {
        0: { cellWidth: 22 }, 1: { cellWidth: 60 }, 2: { cellWidth: 40 },
        3: { halign: 'right', cellWidth: 28 }, 4: { cellWidth: 22 },
        5: { halign: 'right', cellWidth: 38 }, 6: { halign: 'right', cellWidth: 38 },
        7: { halign: 'right', cellWidth: 38 }, 8: { halign: 'right', cellWidth: 38 },
        9: { halign: 'right', cellWidth: 34 }, 10: { halign: 'right', cellWidth: 38 },
        11: { halign: 'right', cellWidth: 38 }, 12: { halign: 'right', cellWidth: 'auto' },
      },
      margin: { left: margin, right: margin },
    });

    y = (doc as any).lastAutoTable.finalY + 20;

    // ── SECTION 4: SIGNATURES ────────────────────────────────────────────────
    if (y > doc.internal.pageSize.getHeight() - 70) { doc.addPage(); y = 40; }

    const sigLabels = ['AP', 'FC', 'CFO', 'CEO'];
    const sigW = contentW / sigLabels.length;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    sigLabels.forEach((label, i) => {
      const sx = margin + i * sigW;
      doc.setLineWidth(0.5);
      doc.line(sx + 10, y + 28, sx + sigW - 10, y + 28);
      doc.text(label, sx + sigW / 2, y + 40, { align: 'center' });
    });

    // Footer
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150);
    const now = new Date();
    const generatedLine = `Generated by Royal Shipment Tracker — ${now.toLocaleDateString('en-GB')} ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    const downloadedLine = `Downloaded by: ${config.downloadedBy}`;
    const footerY = doc.internal.pageSize.getHeight() - 22;
    doc.text(generatedLine, pageW / 2, footerY, { align: 'center' });
    doc.text(downloadedLine, pageW / 2, footerY + 10, { align: 'center' });
    doc.setTextColor(0);

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

  private readonly STAGE_ORDER = [
    'Shipment Entry',
    'Shipment Tracker',
    'BL Details',
    'Document Tracker',
    'Port and Customs Clearance Tracker',
    'Storage Allocation & Arrival',
    'Quality',
    'Payment & Costing',
  ] as const;

  /** 0–100 progress for the ship animation based on current stage */
  getShipProgress(currentStage: string): number {
    const index = this.STAGE_ORDER.indexOf(currentStage as any);
    if (index < 0) return 0;
    return Math.round((index / (this.STAGE_ORDER.length - 1)) * 100);
  }

  /** True when the shipment has reached or passed Storage stage */
  isShipArrived(currentStage: string): boolean {
    const index = this.STAGE_ORDER.indexOf(currentStage as any);
    const storageIndex = this.STAGE_ORDER.indexOf('Storage Allocation & Arrival');
    return index >= storageIndex;
  }

  isSaving(index: number, section: 'bl' | 'cost' | 'storage'): boolean {
    return this.savingKey() === `${section}-${index}`;
  }

  async saveBLDetails(index: number): Promise<void> {
    const row = this.formArray.at(index);
    const shipmentId = this.shipmentData()?.shipment?._id;
    if (!row || !shipmentId) return;

    if (this.getActiveTab(index) === 'storage') {
      const validation = this.validateStorageAllocationContainers(row);
      if (!validation.valid) {
        this.storageValidationMessage.set(validation.message);
        this.storageValidationDetails.set(validation.mismatches);
        this.storageValidationModalVisible.set(true);
        return;
      }
    }

    const containerId = row.get('containerId')?.value;
    if (!containerId) {
      this.notificationService.warn('Missing container', 'This shipment row is not linked to a container yet.');
      return;
    }

    const confirmed = await this.confirmDialog.ask({
      message: `Save B/L details for Shipment ${index + 1}?`,
      header: 'Save B/L Details',
      acceptLabel: 'Yes, Save',
    });
    if (!confirmed) return;

    // Validate required BL fields
    const blNo = String(row.get('blNo')?.value || '').trim();
    const shippedOnBoard = row.get('shippedOnBoard')?.value;
    const portOfLoading = String(row.get('portOfLoading')?.value || '').trim();
    const portOfDischarge = String(row.get('portOfDischarge')?.value || '').trim();
    const noOfContainers = row.get('noOfContainers')?.value;
    const noOfBags = row.get('noOfBags')?.value;
    const quantityByMt = row.get('quantityByMt')?.value;
    const shippingLine = String(row.get('shippingLine')?.value || '').trim();
    const freeDetentionDays = row.get('freeDetentionDays')?.value;
    const maximumDetentionDays = row.get('maximumDetentionDays')?.value;

    const missingBLFields: string[] = [];
    if (!blNo) missingBLFields.push('B/L No');
    if (!shippedOnBoard) missingBLFields.push('Shipped On Board');
    if (!portOfLoading) missingBLFields.push('Port of Loading');
    if (!portOfDischarge) missingBLFields.push('Port of Discharge');
    if (noOfContainers == null || noOfContainers === '') missingBLFields.push('No of Containers');
    if (noOfBags == null || noOfBags === '') missingBLFields.push('No of Bags');
    if (quantityByMt == null || quantityByMt === '') missingBLFields.push('Quantity by MT');
    if (!shippingLine) missingBLFields.push('Shipping Line');
    if (freeDetentionDays == null || freeDetentionDays === '') missingBLFields.push('Free Detention Days');
    if (maximumDetentionDays == null || maximumDetentionDays === '') missingBLFields.push('Maximum Detention Days');

    if (missingBLFields.length > 0) {
      this.notificationService.error('Required Fields Missing', `Please fill: ${missingBLFields.join(', ')}`);
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

  async saveCostSheet(index: number): Promise<void> {
    const row = this.formArray.at(index);
    const shipmentId = this.shipmentData()?.shipment?._id;
    if (!row || !shipmentId) return;

    const containerId = row.get('containerId')?.value;
    if (!containerId) {
      this.notificationService.warn('Missing container', 'This shipment row is not linked to a container yet.');
      return;
    }

    const confirmed = await this.confirmDialog.ask({
      message: `Save cost sheet for Shipment ${index + 1}?`,
      header: 'Save Cost Sheet',
      acceptLabel: 'Yes, Save',
    });
    if (!confirmed) return;

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
        this.editingCostSheet.update((current) => ({ ...current, [index]: false }));
        this.notificationService.success('Saved', 'Cost sheet booking saved successfully.');
        this.store.dispatch(ShipmentActions.loadShipmentDetail({ id: shipmentId }));
      },
      error: (error) => {
        this.savingKey.set(null);
        this.notificationService.error('Save failed', error.error?.message || 'Could not save cost sheet booking.');
      }
    });
  }

  async saveStorageAllocations(index: number): Promise<void> {
    const row = this.formArray.at(index);
    const shipmentId = this.shipmentData()?.shipment?._id;
    if (!row || !shipmentId) return;

    const containerId = row.get('containerId')?.value;
    if (!containerId) {
      this.notificationService.warn('Missing container', 'This shipment row is not linked to a container yet.');
      return;
    }

    const validation = this.validateStorageAllocationContainers(row);
    if (!validation.valid) {
      this.storageValidationMessage.set(validation.message);
      this.storageValidationDetails.set(validation.mismatches);
      this.storageValidationModalVisible.set(true);
      return;
    }

    const confirmed = await this.confirmDialog.ask({
      message: `Save storage allocations for Shipment ${index + 1}?`,
      header: 'Save Storage Allocations',
      acceptLabel: 'Yes, Save',
    });
    if (!confirmed) return;

    // Validate storage allocation required fields
    const storageRows = this.getStorageRows(row).getRawValue();
    const invalidStorageRows = storageRows.filter((entry: any) =>
      !String(entry.containerSerialNo || '').trim() ||
      (entry.bags == null || entry.bags === '') ||
      !String(entry.warehouse || '').trim()
    );
    if (invalidStorageRows.length > 0) {
      this.notificationService.error('Required Fields Missing', 'Container Serial No, Bags, and Warehouse are required for all storage allocation rows.');
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

    const shipment = this.shipmentData()?.shipment as any;
    const actual = this.shipmentData()?.actual?.[index] as any;
    const costRows = this.getCostSheetRows(row).getRawValue();
    const fmt = (v: unknown) => this.formatCurrency(v);
    const fmtDate = (v: unknown) => this.formatDateForReport(v);

    // Exchange rate
    const totalFC = Number(shipment?.totalFC) || 0;
    const amountAED = Number(shipment?.amountAED) || 0;
    const exchangeRate = totalFC > 0 && amountAED > 0 ? fmt(amountAED / totalFC) : '3.67';

    // Storage / arrival data
    const firstStorage = actual?.storageSplits?.[0];
    const grvNo = firstStorage?.grn || actual?.grn?.grnNo || '';
    const arrivedAtWH = firstStorage?.receivedOnDate ? fmtDate(firstStorage.receivedOnDate) : '';
    const arrivedAtPort = actual?.arrivalOn ? fmtDate(actual.arrivalOn) : '';
    const clearedOn = actual?.clearedOn || actual?.clearance?.clearedOn;
    let noOfDaysAtPort = '';
    if (actual?.arrivalOn && clearedOn) {
      const diff = Math.round((new Date(clearedOn).getTime() - new Date(actual.arrivalOn).getTime()) / (1000 * 60 * 60 * 24));
      noOfDaysAtPort = String(diff);
    }

    const packagingExpenses: any[] = actual?.packagingExpenses || [];

    // Current logged-in user
    const currentUser = this.authService.getCurrentUser();
    const downloadedBy = currentUser
      ? `${currentUser.name} (${currentUser.role}) — ${new Date().toLocaleDateString('en-GB')} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
      : 'Unknown';

    this.downloadCostingSheetPdf({
      shipmentNo: this.getShipmentNoLabel(index),
      date: fmtDate(new Date()),
      csNo: row.get('blNo')?.value || '',
      vendor: shipment?.supplierName || shipment?.supplier || '',
      country: shipment?.countryOfOrigin || '',
      invoiceAmountFC: fmt(shipment?.totalFC ?? 0),
      exchangeRate,
      invoiceAmountAED: fmt(shipment?.amountAED ?? (Number(shipment?.totalFC ?? 0) * 3.67)),
      incoTerms: shipment?.incoterms || '',
      paymentTerms: shipment?.paymentTerms || '',
      comInv: actual?.commercialInvoiceNo || '',
      profNo: shipment?.piNo || '',
      murabahaNo: actual?.murabahaContractSubmittedDate ? fmtDate(actual.murabahaContractSubmittedDate) : '',
      shipmentNo2: this.getShipmentNoLabel(index),
      shippingLine: row.get('shippingLine')?.value || actual?.shippingLine || '',
      blNo: row.get('blNo')?.value || actual?.BLNo || '',
      noOfContainers: String(row.get('noOfContainers')?.value || actual?.noOfContainers || ''),
      loadingPort: row.get('portOfLoading')?.value || actual?.portOfLoading || shipment?.portOfLoading || '',
      despatchPort: row.get('portOfDischarge')?.value || actual?.portOfDischarge || shipment?.portOfDischarge || '',
      arrivedAtPort,
      arrivedAtWH,
      noOfDaysAtPort,
      grvNo,
      decNo: '',
      decValue: fmt(shipment?.totalFC ?? 0),
      downloadedBy,
      costRows: costRows.map((entry: any) => ({
        sn: Number(entry.sn) || 0,
        description: entry.description || '',
        requestAmount: fmt(entry.requestAmount ?? 0),
        actualCostDH: fmt(entry.paidAmount ?? 0),
        billRef: '',
        remarks: '',
      })),
      itemRows: packagingExpenses.map((e: any, i: number) => ({
        slNo: i + 1,
        item: e.item || '',
        packing: e.packing || '',
        qty: fmt(e.qty ?? 0),
        uom: e.uom || '',
        unitCostFC: fmt(e.unitCostFC ?? 0),
        unitCostDH: fmt(e.unitCostDH ?? 0),
        totalCostFC: fmt(e.totalCostFC ?? 0),
        totalCostDH: fmt(e.totalCostDH ?? 0),
        allocationFactor: fmt(e.expenseAllocationFactor ?? 0),
        expensesAllocated: fmt(e.expensesAllocated ?? 0),
        totalValueWithExpenses: fmt(e.totalValueWithExpenses ?? 0),
        landedCostPerUnit: fmt(e.landedCostPerUnit ?? 0),
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
