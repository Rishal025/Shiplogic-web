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
  /** POINT 7: When embedded inside BL Details, set the initial tab to show */
  @Input() initialTab: 'allocation' | 'costing' | null = null;
  /** POINT 7: When embedded inside BL Details, restrict to a single shipment index */
  @Input() singleShipmentIndex: number | null = null;
  /** When true, the payment costing section has already been authority-approved and should stay read-only. */
  @Input() costingApproved = false;

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

  getSingleShipmentGroup(): AbstractControl | null {
    if (this.singleShipmentIndex == null) return null;
    return this.formArray?.controls?.[this.singleShipmentIndex] ?? null;
  }

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
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const M = 28;
    const CW = pageW - M * 2;
    const fmtN = (v: unknown) => this.formatCurrency(v);

    // ── HEADER ───────────────────────────────────────────────────────────────
    doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('ROYAL HORIZON GENERAL TRADING', M, 22);
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal');
    doc.text('COSTING SHEET', M, 31);

    const bW = 120, bH = 22, bX = pageW - M - bW, bY = 14;
    doc.setDrawColor(0); doc.setLineWidth(0.4);
    doc.rect(bX, bY, bW, bH);
    doc.line(bX, bY + 11, bX + bW, bY + 11);
    doc.line(bX + 38, bY, bX + 38, bY + bH);
    doc.setFontSize(6.5); doc.setFont('helvetica', 'bold');
    doc.text('Date', bX + 3, bY + 8);
    doc.text('C.S No.', bX + 3, bY + 19);
    doc.setFont('helvetica', 'normal');
    doc.text(config.date, bX + 42, bY + 8);
    doc.text(config.csNo, bX + 42, bY + 19);

    // ── IMPORT DETAILS TABLE ─────────────────────────────────────────────────
    const leftFields: [string, string][] = [
      ['Vendor', config.vendor], ['Country', config.country],
      ['Invoice Amount FC', config.invoiceAmountFC], ['Exchange Rate', config.exchangeRate],
      ['Invoice Amount AED', config.invoiceAmountAED], ['Inco Terms', config.incoTerms],
      ['Payment Terms', config.paymentTerms], ['Com Inv', config.comInv],
      ['Prof No', config.profNo], ['Murabaha/TT No', config.murabahaNo],
    ];
    const rightFields: [string, string][] = [
      ['Shipment No', config.shipmentNo2], ['Shipping Line', config.shippingLine],
      ['BL No', config.blNo], ['No of Containers', config.noOfContainers],
      ['Loading Port', config.loadingPort], ['Despatch Port', config.despatchPort],
      ['Arrived at Port', config.arrivedAtPort], ['Arrived at WH', config.arrivedAtWH],
      ['No of Days at Port', config.noOfDaysAtPort], ['GRV No', config.grvNo],
      ['Dec No', config.decNo], ['Dec Value', config.decValue],
    ];
    const nRows = Math.max(leftFields.length, rightFields.length);
    const importBody: any[][] = [];
    for (let i = 0; i < nRows; i++) {
      importBody.push([
        leftFields[i]?.[0] ?? '', leftFields[i]?.[1] ?? '',
        rightFields[i]?.[0] ?? '', rightFields[i]?.[1] ?? '',
      ]);
    }

    autoTable(doc, {
      startY: 36,
      body: importBody,
      theme: 'grid',
      styles: { fontSize: 6.5, cellPadding: { top: 1.5, bottom: 1.5, left: 3, right: 3 }, lineColor: [180, 180, 180], lineWidth: 0.2 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: CW * 0.13, fillColor: [245, 247, 250] },
        1: { cellWidth: CW * 0.24 },
        2: { fontStyle: 'bold', cellWidth: CW * 0.13, fillColor: [245, 247, 250] },
        3: { cellWidth: 'auto' },
      },
      margin: { left: M, right: M },
      tableLineColor: [0, 0, 0],
      tableLineWidth: 0.4,
    });

    let y = (doc as any).lastAutoTable.finalY + 6;

    // ── COST BREAKDOWN + CUSTOM VALUE (side by side) ─────────────────────────
    const costTotal = config.costRows.reduce((s, r) => s + (Number(r.actualCostDH) || 0), 0);
    const costBody: any[][] = config.costRows.map((r) => [
      r.sn, r.description, r.actualCostDH ? fmtN(r.actualCostDH) : '', r.billRef || '', r.remarks || '',
    ]);
    costBody.push(['', 'TOTAL', fmtN(costTotal), '', '']);

    const customBody: any[][] = config.costRows.map((r) => {
      const dh = Number(r.actualCostDH) || 0;
      const vat = dh * 0.05;
      return [vat ? fmtN(vat) : '', '', '', vat ? fmtN(vat) : ''];
    });
    const totalVat = config.costRows.reduce((s, r) => s + (Number(r.actualCostDH) || 0) * 0.05, 0);
    customBody.push([fmtN(totalVat), '', '', fmtN(totalVat)]);

    const costTW = CW * 0.555;
    const custTW = CW - costTW - 4;
    const custX = M + costTW + 4;

    doc.setFontSize(6); doc.setFont('helvetica', 'bold');
    doc.text('CUSTOM VALUE TAKEN WITHOUT DISCOUNT', custX + 2, y + 5);
    y += 7;

    autoTable(doc, {
      startY: y,
      head: [['Sn', 'Description', 'Cost DH', 'Bill Ref.', 'Payment Ref./Remarks']],
      body: costBody,
      theme: 'grid',
      styles: { fontSize: 6.5, cellPadding: { top: 1.8, bottom: 1.8, left: 2.5, right: 2.5 }, lineColor: [180, 180, 180], lineWidth: 0.2 },
      headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: 'bold', fontSize: 6.5, lineColor: [0, 0, 0], lineWidth: 0.3 },
      columnStyles: {
        0: { cellWidth: 18, halign: 'center' },
        1: { cellWidth: 'auto' },
        2: { halign: 'right', cellWidth: 58 },
        3: { cellWidth: 52 },
        4: { cellWidth: 68 },
      },
      didParseCell: (data: any) => {
        if (data.row.index === costBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [240, 240, 240];
        }
      },
      tableWidth: costTW,
      tableLineColor: [0, 0, 0],
      tableLineWidth: 0.4,
      margin: { left: M, right: M + custTW + 4 },
    });

    const costFinalY = (doc as any).lastAutoTable.finalY;

    // Custom value: VAT Applied RH = Costed DH × 0.05
    // Paid WD Vat For RH = VAT Applied RH (same value — RH pays the VAT)
    // Paid WD Vat For Supplier Ac = user-entered (blank by default)
    // Total Paid Frm Adv = Paid WD Vat For RH + Paid WD Vat For Supplier Ac
    const customBody2: any[][] = config.costRows.map((r) => {
      const dh = Number(r.actualCostDH) || 0;
      const paidRH = dh; // Paid WD Vat For RH = Costed DH
      const totalPaid = paidRH; // Total Paid Frm Adv = Paid WD Vat For RH + 0
      return [
        '',                          // VAT Applied RH — blank
        paidRH ? fmtN(paidRH) : '', // Paid WD Vat For RH = Costed DH
        '',                          // Paid WD Vat For Supplier AC — blank
        totalPaid ? fmtN(totalPaid) : '', // Total Paid Frm Adv
      ];
    });
    const totPaidRH2 = config.costRows.reduce((s, r) => s + (Number(r.actualCostDH) || 0), 0);
    customBody2.push(['', fmtN(totPaidRH2), '', fmtN(totPaidRH2)]);

    autoTable(doc, {
      startY: y,
      head: [['Vat Applied\nRH', 'Paid WD Vat\nFor RH', 'Paid WD Vat\nFor Supplier Ac', 'Totl Paid\nFrm Adv']],
      body: customBody2,
      theme: 'grid',
      styles: { fontSize: 6, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, halign: 'right', lineColor: [180, 180, 180], lineWidth: 0.2 },
      headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: 'bold', fontSize: 6, lineColor: [0, 0, 0], lineWidth: 0.3 },
      columnStyles: {
        0: { halign: 'right', cellWidth: 'auto' },
        1: { halign: 'right', cellWidth: 'auto' },
        2: { halign: 'right', cellWidth: 'auto' },
        3: { halign: 'right', cellWidth: 'auto' },
      },
      didParseCell: (data: any) => {
        if (data.row.index === customBody2.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [240, 240, 240];
        }
      },
      tableWidth: custTW,
      tableLineColor: [0, 0, 0],
      tableLineWidth: 0.4,
      margin: { left: custX, right: M },
    });

    y = Math.max(costFinalY, (doc as any).lastAutoTable.finalY) + 6;

    // ── ITEM COSTING TABLE ───────────────────────────────────────────────────
    if (y > pageH - 90) { doc.addPage(); y = M; }

    const exRate = Number(config.exchangeRate) || 3.67;
    const totalCostDHSum = config.itemRows.reduce((s, r) => s + (Number(r.totalCostDH) || 0), 0);
    const totalCostFCSum = config.itemRows.reduce((s, r) => s + (Number(r.totalCostFC) || 0), 0);
    const totalExpAllocated = config.itemRows.reduce((s, r) => s + (Number(r.expensesAllocated) || 0), 0);
    const grandTotalValue = config.itemRows.reduce((s, r) => s + (Number(r.totalValueWithExpenses) || 0), 0);
    const totalQty = config.itemRows.reduce((s, r) => s + (Number(r.qty) || 0), 0);

    const itemBody: any[][] = config.itemRows.map((r) => {
      const unitFC = Number(r.unitCostFC) || 0;
      const unitDH = unitFC * exRate;
      const qty = Number(r.qty) || 0;
      const totFC = unitFC * qty;
      const totDH = unitDH * qty;
      const allocFactor = totalCostDHSum > 0 ? totDH / totalCostDHSum : 0;
      const expAlloc = allocFactor * costTotal;
      const totWithExp = totDH + expAlloc;
      const landedCost = qty > 0 ? totWithExp / qty : 0;
      return [
        r.slNo, r.item, r.packing,
        qty ? fmtN(qty) : '', r.uom,
        unitFC ? fmtN(unitFC) : '', unitDH ? fmtN(unitDH) : '',
        totFC ? fmtN(totFC) : '', totDH ? fmtN(totDH) : '',
        allocFactor ? (allocFactor * 100).toFixed(4) + '%' : '0.0000%',
        expAlloc ? fmtN(expAlloc) : '',
        totWithExp ? fmtN(totWithExp) : '',
        landedCost ? fmtN(landedCost) : '',
      ];
    });
    itemBody.push([
      'TOTAL', '', '',
      totalQty ? fmtN(totalQty) : '', '',
      '', '',
      totalCostFCSum ? fmtN(totalCostFCSum) : '', totalCostDHSum ? fmtN(totalCostDHSum) : '',
      '1.00',
      totalExpAllocated ? fmtN(totalExpAllocated) : '',
      grandTotalValue ? fmtN(grandTotalValue) : '',
      '',
    ]);

    autoTable(doc, {
      startY: y,
      head: [[
        'Sl No', 'Item', 'Packing', 'Qty', 'UOM',
        { content: 'Unit Cost', colSpan: 2 } as any,
        { content: 'Total Cost', colSpan: 2 } as any,
        'Expenses\nAllocation\nFactor', 'Expenses\nAllocated', 'Total Value\nWith Expenses', 'Landed\nCost/Unit',
      ], [
        '', '', '', '', '',
        'FC', 'DH', 'FC', 'DH',
        '', '', '', '',
      ]],
      body: itemBody.length ? itemBody : [['—', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—']],
      theme: 'grid',
      styles: { fontSize: 6.5, cellPadding: { top: 1.8, bottom: 1.8, left: 2.5, right: 2.5 }, lineColor: [180, 180, 180], lineWidth: 0.2 },
      headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: 'bold', fontSize: 6.5, lineColor: [0, 0, 0], lineWidth: 0.3, halign: 'center' },
      columnStyles: {
        0: { cellWidth: 20, halign: 'center' },
        1: { cellWidth: 90 },
        2: { cellWidth: 55 },
        3: { halign: 'right', cellWidth: 40 },
        4: { cellWidth: 28 },
        5: { halign: 'right', cellWidth: 42 },
        6: { halign: 'right', cellWidth: 42 },
        7: { halign: 'right', cellWidth: 42 },
        8: { halign: 'right', cellWidth: 42 },
        9: { halign: 'right', cellWidth: 46 },
        10: { halign: 'right', cellWidth: 46 },
        11: { halign: 'right', cellWidth: 52 },
        12: { halign: 'right', cellWidth: 'auto' },
      },
      didParseCell: (data: any) => {
        if (data.row.index === itemBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [240, 240, 240];
        }
      },
      tableLineColor: [0, 0, 0],
      tableLineWidth: 0.4,
      margin: { left: M, right: M },
    });

    y = (doc as any).lastAutoTable.finalY + 10;

    // ── APPROVALS ────────────────────────────────────────────────────────────
    if (y > pageH - 44) { doc.addPage(); y = M; }

    const sigs = ['AP', 'FC', 'CFO', 'CEO'];
    const sigW = CW / sigs.length;
    sigs.forEach((label, i) => {
      const sx = M + i * sigW;
      doc.setFontSize(7); doc.setFont('helvetica', 'bold');
      doc.text(label, sx + 4, y + 8);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
      doc.setDrawColor(150); doc.setLineWidth(0.3);
      doc.line(sx + 4, y + 22, sx + sigW - 8, y + 22);
    });

    // Footer
    doc.setFontSize(6); doc.setFont('helvetica', 'normal'); doc.setTextColor(150);
    const now = new Date();
    doc.text(
      `Generated by Royal Shipment Tracker — ${now.toLocaleDateString('en-GB')} ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}   |   Downloaded by: ${config.downloadedBy}`,
      pageW / 2, pageH - 10, { align: 'center' }
    );
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
    // POINT 7: When embedded in BL Details, use initialTab to pre-select the correct tab
    return this.activeTabs()[index] ?? this.initialTab ?? 'allocation';
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

  /** Returns the effective exchange rate: amountAED / totalFC, or 3.67 as fallback. */
  private getExchangeRate(): number {
    const shipment = this.shipmentData()?.shipment as any;
    const totalFC = Number(shipment?.totalFC) || 0;
    const amountAED = Number(shipment?.amountAED) || 0;
    if (totalFC > 0 && amountAED > 0) return amountAED / totalFC;
    return 3.67;
  }

  /** Called when unitCostFC or qty changes in a packaging expense row — auto-calculates DH and totals. */
  onPackagingRowCalc(row: AbstractControl): void {
    const rate = this.getExchangeRate();
    const unitCostFC = Number(row.get('unitCostFC')?.value) || 0;
    const qty = Number(row.get('qty')?.value) || 0;

    const unitCostDH = Math.round(unitCostFC * rate * 100) / 100;
    const totalCostFC = Math.round(unitCostFC * qty * 100) / 100;
    const totalCostDH = Math.round(unitCostDH * qty * 100) / 100;

    row.get('unitCostDH')?.setValue(unitCostDH, { emitEvent: false });
    row.get('totalCostFC')?.setValue(totalCostFC, { emitEvent: false });
    row.get('totalCostDH')?.setValue(totalCostDH, { emitEvent: false });
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

    // POINT 7: Actual Paid validation removed — column no longer exists
    // Proceed directly to save

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
      // POINT 7: actualPaid removed — difference is now paidAmount - requestAmount
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

  /** POINT 7: Difference = Paid Amount − Request Amount (Actual Paid column removed) */
  getDifference(row: AbstractControl): string {
    const paidAmount = Number(row.get('paidAmount')?.value) || 0;
    const requestAmount = Number(row.get('requestAmount')?.value) || 0;
    const diff = paidAmount - requestAmount;
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(diff);
  }

  /** POINT 7: Sum of (Paid Amount − Request Amount) across all costing rows */
  getDifferenceTotal(group: AbstractControl): string {
    const costings = this.getPaymentCostings(group);
    const total = costings.controls.reduce((sum, row) => {
      const paidAmount = Number(row.get('paidAmount')?.value) || 0;
      const requestAmount = Number(row.get('requestAmount')?.value) || 0;
      return sum + (paidAmount - requestAmount);
    }, 0);
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(total);
  }

}
