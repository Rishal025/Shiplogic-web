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
import { ConfirmDialogService } from '../../../../../../core/services/confirm-dialog.service';
import { AuthService } from '../../../../../../core/services/auth.service';
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
  private confirmDialog = inject(ConfirmDialogService);
  private authService = inject(AuthService);

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

    // ── SECTION 1 ────────────────────────────────────────────────────────────
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
      ['Vendor', config.vendor], ['Country', config.country],
      ['Invoice Amount FC', config.invoiceAmountFC], ['Exchange Rate', config.exchangeRate],
      ['Invoice Amount AED', config.invoiceAmountAED], ['Inco Terms', config.incoTerms],
      ['Payment Terms', config.paymentTerms], ['Com Inv', config.comInv],
      ['Prof No', config.profNo], ['Murabaha / TT No', config.murabahaNo],
    ];
    const rightFields: [string, string][] = [
      ['Shipment No', config.shipmentNo2], ['Shipping Line', config.shippingLine],
      ['BL No', config.blNo], ['No of Containers', config.noOfContainers],
      ['Loading Port', config.loadingPort], ['Despatch Port', config.despatchPort],
      ['Arrived at Port', config.arrivedAtPort], ['Arrived at WH', config.arrivedAtWH],
      ['No of Days at Port', config.noOfDaysAtPort], ['GRV No', config.grvNo],
      ['Dec No', config.decNo], ['Dec Value', config.decValue],
    ];

    const maxRows = Math.max(leftFields.length, rightFields.length);
    const tableTop = y + 2;
    const tableH = (maxRows + 1) * rowH + 4;

    doc.setLineWidth(0.4);
    doc.rect(leftX, tableTop, colW, tableH);
    doc.rect(rightX, tableTop, colW, tableH);

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

    // ── SECTION 2 ────────────────────────────────────────────────────────────
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
      head: [['SN', 'Description', 'Request Amount', 'Actual Paid', 'Bill Ref.', 'Payment Ref / Remarks']],
      body: costBody,
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 3 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: 24 }, 1: { cellWidth: 160 },
        2: { halign: 'right', cellWidth: 72 },
        3: { halign: 'right', cellWidth: 72 }, 4: { cellWidth: 72 }, 5: { cellWidth: 'auto' },
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

    // ── SECTION 3 ────────────────────────────────────────────────────────────
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

    const sigLabels = ['AP', 'FC', 'CFO', 'MD'];
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
    const genLine = `Generated by Royal Shipment Tracker — ${now.toLocaleDateString('en-GB')} ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    const dlLine = `Downloaded by: ${config.downloadedBy}`;
    const footerY = doc.internal.pageSize.getHeight() - 22;
    doc.text(genLine, pageW / 2, footerY, { align: 'center' });
    doc.text(dlLine, pageW / 2, footerY + 10, { align: 'center' });
    doc.setTextColor(0);

    doc.save(`${config.shipmentNo.replace(/[^a-z0-9_-]/gi, '_')}-costing-sheet.pdf`);
  }

  generateAllocationReport(index: number): void {
    const group = this.formArray.at(index) as FormGroup | null;
    if (!group) return;

    const shipment = this.shipmentData()?.shipment as any;
    const actual = this.shipmentData()?.actual?.[index] as any;
    const fmt = (v: unknown) => this.formatCurrency(v);
    const fmtDate = (v: unknown) => this.formatDateForReport(v);

    const totalFC = Number(shipment?.totalFC) || 0;
    const amountAED = Number(shipment?.amountAED) || 0;
    const exchangeRate = totalFC > 0 && amountAED > 0 ? fmt(amountAED / totalFC) : '3.67';

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

    const currentUser = this.authService.getCurrentUser();
    const downloadedBy = currentUser
      ? `${currentUser.name} (${currentUser.role}) — ${new Date().toLocaleDateString('en-GB')} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
      : 'Unknown';

    // Use payment allocation rows as cost breakdown
    const allocationRows = this.getPaymentAllocations(group).controls;

    this.downloadCostingSheetPdf({
      shipmentNo: this.getShipmentNoLabel(index),
      date: fmtDate(new Date()),
      csNo: actual?.BLNo || '',
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
      shippingLine: actual?.shippingLine || '',
      blNo: actual?.BLNo || '',
      noOfContainers: String(actual?.noOfContainers || ''),
      loadingPort: actual?.portOfLoading || shipment?.portOfLoading || '',
      despatchPort: actual?.portOfDischarge || shipment?.portOfDischarge || '',
      arrivedAtPort,
      arrivedAtWH,
      noOfDaysAtPort,
      grvNo,
      decNo: '',
      decValue: fmt(shipment?.totalFC ?? 0),
      downloadedBy,
      costRows: allocationRows.map((row, i) => ({
        sn: row.get('sn')?.value ?? i + 1,
        description: row.get('description')?.value ?? '',
        requestAmount: fmt(row.get('requestAmount')?.value ?? 0),
        actualCostDH: fmt(row.get('paidAmount')?.value ?? 0),
        billRef: '',
        remarks: row.get('reference')?.value ?? '',
      })),
      itemRows: [],
    });
  }

  generateReport(index: number): void {
    const group = this.formArray.at(index) as FormGroup | null;
    if (!group) return;

    const shipment = this.shipmentData()?.shipment as any;
    const actual = this.shipmentData()?.actual?.[index] as any;
    const fmt = (v: unknown) => this.formatCurrency(v);
    const fmtDate = (v: unknown) => this.formatDateForReport(v);

    const totalFC = Number(shipment?.totalFC) || 0;
    const amountAED = Number(shipment?.amountAED) || 0;
    const exchangeRate = totalFC > 0 && amountAED > 0 ? fmt(amountAED / totalFC) : '3.67';

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

    const currentUser = this.authService.getCurrentUser();
    const downloadedBy = currentUser
      ? `${currentUser.name} (${currentUser.role}) — ${new Date().toLocaleDateString('en-GB')} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
      : 'Unknown';

    const costingRows = this.getPaymentCostings(group).controls;
    const packagingRows = this.getPackagingExpenses(group).controls;

    this.downloadCostingSheetPdf({
      shipmentNo: this.getShipmentNoLabel(index),
      date: fmtDate(new Date()),
      csNo: actual?.BLNo || '',
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
      shippingLine: actual?.shippingLine || '',
      blNo: actual?.BLNo || '',
      noOfContainers: String(actual?.noOfContainers || ''),
      loadingPort: actual?.portOfLoading || shipment?.portOfLoading || '',
      despatchPort: actual?.portOfDischarge || shipment?.portOfDischarge || '',
      arrivedAtPort,
      arrivedAtWH,
      noOfDaysAtPort,
      grvNo,
      decNo: '',
      decValue: fmt(shipment?.totalFC ?? 0),
      downloadedBy,
      costRows: costingRows.map((row, i) => ({
        sn: row.get('sn')?.value ?? i + 1,
        description: row.get('description')?.value ?? '',
        requestAmount: fmt(row.get('requestAmount')?.value ?? 0),
        actualCostDH: fmt(row.get('actualPaid')?.value ?? 0),
        billRef: row.get('refBillNo')?.value ?? '',
        remarks: [row.get('refBillVendor')?.value, fmtDate(row.get('refBillDate')?.value)].filter(Boolean).join(' / '),
      })),
      itemRows: packagingRows.map((row, i) => ({
        slNo: row.get('sn')?.value ?? i + 1,
        item: row.get('item')?.value ?? '',
        packing: row.get('packing')?.value ?? '',
        qty: fmt(row.get('qty')?.value ?? 0),
        uom: row.get('uom')?.value ?? '',
        unitCostFC: fmt(row.get('unitCostFC')?.value ?? 0),
        unitCostDH: fmt(row.get('unitCostDH')?.value ?? 0),
        totalCostFC: fmt(row.get('totalCostFC')?.value ?? 0),
        totalCostDH: fmt(row.get('totalCostDH')?.value ?? 0),
        allocationFactor: fmt(row.get('expenseAllocationFactor')?.value ?? 0),
        expensesAllocated: fmt(row.get('expensesAllocated')?.value ?? 0),
        totalValueWithExpenses: fmt(row.get('totalValueWithExpenses')?.value ?? 0),
        landedCostPerUnit: fmt(row.get('landedCostPerUnit')?.value ?? 0),
      })),
    });
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

  hasAllocationRequestAmount(group: AbstractControl): boolean {
    return this.getPaymentAllocations(group).controls.some((row) => Number(row.get('requestAmount')?.value || 0) > 0);
  }

  isAllocationSaved(index: number): boolean {
    const shipment = this.shipmentData()?.actual?.[index];
    const rows = shipment?.paymentAllocations || [];
    return rows.some((entry: any) => Number(entry?.requestAmount || 0) > 0 || Number(entry?.paidAmount || 0) > 0);
  }

  isCostingSaved(index: number): boolean {
    const shipment = this.shipmentData()?.actual?.[index];
    const rows = shipment?.paymentCostings || [];
    return rows.some((entry: any) => Number(entry?.actualPaid || 0) > 0 || String(entry?.refBillNo || '').trim().length > 0);
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

  async saveAllocation(index: number): Promise<void> {
    const group = this.formArray.at(index) as FormGroup | null;
    const shipmentId = this.shipmentData()?.shipment?._id;
    if (!group || !shipmentId) return;

    const containerId = group.get('containerId')?.value;
    if (!containerId) {
      this.notificationService.warn('Missing container', 'This shipment row is not linked to a container yet.');
      return;
    }

    const confirmed = await this.confirmDialog.ask({
      message: `Save payment allocation for Shipment ${index + 1}?`,
      header: 'Save Payment Allocation',
      acceptLabel: 'Yes, Save',
    });
    if (!confirmed) return;

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
        this.setActiveTab(index, 'costing');
        this.store.dispatch(ShipmentActions.loadShipmentDetail({ id: shipmentId }));
      },
      error: (error) => {
        this.savingRowIndex.set(null);
        this.notificationService.error('Save failed', error.error?.message || 'Could not save payment allocation.');
      }
    });
  }

  async saveCosting(index: number): Promise<void> {
    const group = this.formArray.at(index) as FormGroup | null;
    const shipmentId = this.shipmentData()?.shipment?._id;
    if (!group || !shipmentId) return;

    const containerId = group.get('containerId')?.value;
    if (!containerId) {
      this.notificationService.warn('Missing container', 'This shipment row is not linked to a container yet.');
      return;
    }

    const confirmed = await this.confirmDialog.ask({
      message: `Save payment costing details for Shipment ${index + 1}?`,
      header: 'Save Payment Costing',
      acceptLabel: 'Yes, Save',
    });
    if (!confirmed) return;

    // Validate Actual Paid in payment costings
    const costingControls = this.getPaymentCostings(group).controls;
    const missingActualPaid = costingControls.some(row => {
      const actualPaid = row.get('actualPaid')?.value;
      return actualPaid == null || actualPaid === '';
    });
    if (missingActualPaid) {
      this.notificationService.error('Required Fields Missing', 'Actual Paid is required for all payment costing rows.');
      return;
    }

    // Validate packaging expenses required fields — only for rows that have any data entered
    const packagingControls = this.getPackagingExpenses(group).controls;
    const filledPackagingRows = packagingControls.filter((row) => {
      // A row is considered "touched" if any meaningful field has a value
      const item = String(row.get('item')?.value || '').trim();
      const packing = String(row.get('packing')?.value || '').trim();
      const qty = row.get('qty')?.value;
      const uom = String(row.get('uom')?.value || '').trim();
      const unitCostFC = row.get('unitCostFC')?.value;
      const unitCostDH = row.get('unitCostDH')?.value;
      return item || packing || (qty != null && qty !== '' && Number(qty) !== 0) || uom || unitCostFC || unitCostDH;
    });
    if (filledPackagingRows.length > 0) {
      const invalidPackagingRows: number[] = [];
      filledPackagingRows.forEach((row, idx) => {
        const item = String(row.get('item')?.value || '').trim();
        const packing = String(row.get('packing')?.value || '').trim();
        const qty = row.get('qty')?.value;
        const uom = String(row.get('uom')?.value || '').trim();
        if (!item || !packing || qty == null || qty === '' || !uom) {
          invalidPackagingRows.push(idx + 1);
        }
      });
      if (invalidPackagingRows.length > 0) {
        this.notificationService.error('Required Fields Missing', `Packaging expense rows ${invalidPackagingRows.join(', ')}: Item, Packing, Qty, and UOM are required.`);
        return;
      }
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

  /** Actual Paid − Paid Amount for a single costing row */
  getDifference(row: AbstractControl): string {
    const actualPaid = Number(row.get('actualPaid')?.value) || 0;
    const paidAmount = Number(row.get('paidAmount')?.value) || 0;
    const diff = actualPaid - paidAmount;
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(diff);
  }

  /** Sum of (Actual Paid − Paid Amount) across all costing rows */
  getDifferenceTotal(group: AbstractControl): string {
    const costings = this.getPaymentCostings(group);
    const total = costings.controls.reduce((sum, row) => {
      const actualPaid = Number(row.get('actualPaid')?.value) || 0;
      const paidAmount = Number(row.get('paidAmount')?.value) || 0;
      return sum + (actualPaid - paidAmount);
    }, 0);
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(total);
  }

}
