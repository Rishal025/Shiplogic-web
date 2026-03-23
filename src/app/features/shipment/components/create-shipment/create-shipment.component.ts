import { Component, OnDestroy, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subscription, debounceTime, distinctUntilChanged } from 'rxjs';

// PrimeNG Imports (v21 matching package.json)
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { DialogModule } from 'primeng/dialog';

import { PrimaryButtonDirective } from '../../../../shared/directives/button.directive';
import { ShipmentService } from '../../../../core/services/shipment.service';
import { CreateShipmentPayload, ExtractedShipmentData } from '../../../../core/models/shipment.model';
import { ItemService } from '../../../../core/services/item.service';

@Component({
  selector: 'app-create-shipment',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    InputTextModule,
    SelectModule,
    InputNumberModule,
    DatePickerModule,
    TextareaModule,
    ButtonModule,
    ToastModule,
    DialogModule,
    PrimaryButtonDirective
  ],
  providers: [MessageService],
  templateUrl: './create-shipment.component.html',
  styleUrls: ['./create-shipment.component.scss']
})
export class CreateShipmentComponent implements OnInit, OnDestroy {
  shipmentForm!: FormGroup;
  submitting = signal(false);

  // Document extraction: document1 = Purchase order, document2 = Pro-forma Invoice
  document1File = signal<File | null>(null);
  document2File = signal<File | null>(null);
  s1QualityReportFile = signal<File | null>(null);
  extracting = signal(false);
  extractedQ1Report = signal<Record<string, unknown> | null>(null);
  /** Set after extract & autopopulate when response includes shipment_calculations; used for price-mismatch warning. */
  extractionPriceMismatch = signal<{ isPriceMatching: boolean; diffPercent?: number } | null>(null);
  private subscriptions = new Subscription();

  // Document preview modal
  showPreviewModal = signal(false);
  previewUrl = signal<string | null>(null);
  previewTitle = signal('');
  previewIsImage = signal(false);
  previewSafeUrl = computed(() => {
    const url = this.previewUrl();
    if (!url || this.previewIsImage()) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  // Static Dropdown Options
  buyingUnits = [
    { label: 'MT', value: 'MT' },
    { label: 'KG', value: 'KG' },
    { label: 'Bag', value: 'Bag' },
    { label: 'Pallet', value: 'Pallet' },
  ];

  incoTerms = [
    { label: 'CIF', value: 'CIF' },
    { label: 'FOB', value: 'FOB' },
    { label: 'EXWORKS', value: 'EXWORKS' },
    { label: 'C&F', value: 'C&F' }
  ];

  paymentTerms = [
    { label: 'CAD 100%', value: 'CAD 100%' },
    { label: 'Advance 20% BT, Balance 80% CAD', value: 'Advance 20% BT, Balance 80% CAD' },
    { label: 'Advance 30% BT, Balance 70% CAD', value: 'Advance 30% BT, Balance 70% CAD' },
    { label: 'Advance 10% BT, Balance 90% CAD', value: 'Advance 10% BT, Balance 90% CAD' },
    { label: 'BT against Delivery 100%', value: 'BT against Delivery 100%' },
    { label: 'BT against Documents 100%', value: 'BT against Documents 100%' }
  ];

  bankNames = [
    { label: 'ADIB', value: 'ADIB' },
    { label: 'EIB', value: 'EIB' },
    { label: 'DIB', value: 'DIB' }
  ];

  containerSizes = [
    { label: "20'", value: '20' },
    { label: "40'", value: '40' }
  ];

  commodities = [
    { label: 'Rice', value: 'Rice' },
    { label: 'Wheat', value: 'Wheat' },
    { label: 'Sugar', value: 'Sugar' },
    { label: 'Maize', value: 'Maize' },
    { label: 'Soybean', value: 'Soybean' },
    { label: 'Cotton', value: 'Cotton' },
    { label: 'Pulses', value: 'Pulses' },
    { label: 'Other', value: 'Other' }
  ];

  constructor(
    private fb: FormBuilder,
    private shipmentService: ShipmentService,
    private itemService: ItemService,
    private messageService: MessageService,
    private router: Router,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.initForm();
    this.setupAutoFill();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  private initForm(): void {
    this.shipmentForm = this.fb.group({
      // Shipment Info
      commodity: [''],
      piNo: [''],
      piDate: [null],
      fpoNo: [''],
      purchaseDate: [null],
      incoTerms: [null],
      portOfLoading: [''],
      portOfDischarge: [''],
      itemCode: [''],
      brandName: [''],
      barcode: [''],
      variant: [''],
      hsCode: [''],
      itemDescription: [''],

      // Supplier Details
      supplier: ['', Validators.required],
      countryOfOrigin: [''],

      // Quantity of Packaging
      packagingType: [''],
      containerSize: [null],
      fcl: [null],
      pallet: [null],
      bags: [null],
      plannedContainers: [null],

      // Price
      buyingUnit: [null],
      noOfShipments: [null],
      fcPerUnit: [null],
      totalUSD: [{ value: null, disabled: true }],
      totalAED: [{ value: null, disabled: true }],
      paymentTerms: [null],
      bankName: [null],
      advanceAmount: [null],
      expectedETD: [null],
      expectedETA: [null],
      s1QualityReport: [null, Validators.required]
    });

    // Reactive Financial Calculation (Total USD = Planned Containers * FC per Unit)
    // Total AED = Total USD * 3.67 (fixed AED rate)
    const AED_RATE = 3.67;
    this.shipmentForm.valueChanges.subscribe(val => {
        const count = Number(val.plannedContainers) || 0;
        const rate = Number(val.fcPerUnit) || 0;
        const totalUSD = count * rate;
        const totalAED = totalUSD * AED_RATE;

        this.shipmentForm.get('totalUSD')?.setValue(totalUSD > 0 ? totalUSD : 0, { emitEvent: false });
        this.shipmentForm.get('totalAED')?.setValue(totalAED > 0 ? totalAED : 0, { emitEvent: false });
    });
  }

  private setupAutoFill(): void {
    const itemCodeControl = this.shipmentForm.get('itemCode');
    if (itemCodeControl) {
      this.subscriptions.add(
        itemCodeControl.valueChanges
          .pipe(debounceTime(300), distinctUntilChanged())
          .subscribe((value) => {
            const itemCode = typeof value === 'string' ? value.trim() : '';
            if (!itemCode) return;
            this.lookupItemMetadata(itemCode);
          })
      );
    }

    this.subscriptions.add(this.shipmentForm.get('paymentTerms')!.valueChanges.subscribe((term) => {
      const bankNameControl = this.shipmentForm.get('bankName');
      if (!bankNameControl) return;

      if (this.requiresBankName(term)) {
        bankNameControl.addValidators(Validators.required);
      } else {
        bankNameControl.clearValidators();
        bankNameControl.setValue(null, { emitEvent: false });
      }

      bankNameControl.updateValueAndValidity({ emitEvent: false });
    }));
  }

  requiresBankName(term: string | null | undefined): boolean {
    return typeof term === 'string' && term.includes('CAD');
  }

  // Purchase order (document1) & Pro-forma Invoice (document2) for extraction
  onDocument1Selected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.document1File.set(file);
    input.value = '';
  }

  onDocument2Selected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.document2File.set(file);
    input.value = '';
  }

  clearDocument1(): void {
    this.document1File.set(null);
  }

  clearDocument2(): void {
    this.document2File.set(null);
  }

  onQualityReportSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    this.s1QualityReportFile.set(file);
    this.shipmentForm.get('s1QualityReport')?.setValue(file, { emitEvent: false });
    input.value = '';
  }

  removeQualityReport(): void {
    this.s1QualityReportFile.set(null);
    this.shipmentForm.get('s1QualityReport')?.setValue(null, { emitEvent: false });
  }

  hasAllRequiredDocuments(): boolean {
    return !!this.document1File() && !!this.document2File() && !!this.s1QualityReportFile();
  }

  openDocumentPreview(file: File, title: string): void {
    const url = URL.createObjectURL(file);
    this.previewUrl.set(url);
    this.previewTitle.set(title);
    this.previewIsImage.set(file.type.startsWith('image/'));
    this.showPreviewModal.set(true);
  }

  closeDocumentPreview(): void {
    const url = this.previewUrl();
    if (url) URL.revokeObjectURL(url);
    this.previewUrl.set(null);
    this.previewTitle.set('');
    this.showPreviewModal.set(false);
  }

  onPreviewModalHide(): void {
    this.closeDocumentPreview();
  }

  /** Called when dialog visibility changes; only close/revoke when dialog is hidden */
  onPreviewVisibleChange(visible: boolean): void {
    if (!visible) this.closeDocumentPreview();
  }

  /** Label for price-mismatch diff_percent (e.g. "0.51%" or "—"). */
  get priceMismatchDiffLabel(): string {
    const m = this.extractionPriceMismatch();
    if (m?.diffPercent == null) return '—';
    return `${m.diffPercent.toFixed(2)}%`;
  }

  onExtractAndAutopopulate(): void {
    const file1 = this.document1File();
    const file2 = this.document2File();
    const quality = this.s1QualityReportFile();
    if (!file1 || !file2 || !quality) return;

    const formData = new FormData();
    formData.append('document1', file1, file1.name);
    formData.append('document2', file2, file2.name);
    formData.append('s1QualityReport', quality, quality.name);

    this.extracting.set(true);
    this.extractionPriceMismatch.set(null);
    this.shipmentService.extractShipmentFromDocuments(formData).subscribe({
      next: (response) => {
        this.extracting.set(false);
        this.messageService.add({
          severity: 'success',
          summary: 'Extraction complete',
          detail: response.message ?? 'Values extracted and form autopopulated.'
        });
        if (response.data) {
          this.patchFormFromExtraction(response.data);
        }
      },
      error: (err) => {
        this.extracting.set(false);
        console.error('Extract documents error:', err);
        this.messageService.add({
          severity: 'error',
          summary: 'Extraction failed',
          detail: err.error?.message ?? 'Could not extract data from documents.'
        });
      }
    });
  }

  /**
   * Patch Create New Shipment form from extracted data.
   * Resolves supplier/item by supplierCode/itemCode from resolved lists.
   * All keys are optional; missing or invalid values are skipped (no error).
   */
  private patchFormFromExtraction(data: ExtractedShipmentData): void {
    try {
      const d = data as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      this.extractedQ1Report.set((data.q1Report as Record<string, unknown>) ?? null);

      const dateKeys = ['piDate', 'purchaseDate', 'expectedETD', 'expectedETA'];
      for (const key of dateKeys) {
        const v = d[key];
        if (v == null || v === '') continue;
        const dateVal = typeof v === 'string' ? this.parseDate(v) : v;
        if (dateVal != null) patch[key] = dateVal;
      }

      const directKeys = [
        'piNo', 'fpoNo', 'incoTerms', 'portOfLoading', 'portOfDischarge',
        'commodity', 'brandName', 'itemDescription', 'countryOfOrigin',
        'packagingType', 'containerSize', 'fcl', 'pallet', 'bags',
        'plannedContainers', 'noOfShipments', 'buyingUnit', 'fcPerUnit',
        'totalUSD', 'totalAED', 'paymentTerms', 'advanceAmount'
      ];
      for (const key of directKeys) {
        const v = d[key];
        if (v == null) continue;
        if (typeof v === 'string' && v.trim() === '') continue;
        patch[key] = v;
      }

      const rawName = d['supplierName'];
      const name = typeof rawName === 'string' ? rawName.trim() : '';
      if (name) {
        patch['supplier'] = name;
      }

      const rawItemCode = d['itemCode'];
      const itemCode = typeof rawItemCode === 'string' ? rawItemCode.trim() : '';
      if (itemCode) {
        patch['itemCode'] = itemCode;
      }

      this.shipmentForm.patchValue(patch, { emitEvent: false });
      if (itemCode) {
        this.lookupItemMetadata(itemCode);
      }
      // Ensure form validity is recalculated so Save Shipment enables when required fields are set
      this.shipmentForm.updateValueAndValidity({ emitEvent: true });

      const sc = data.shipmentCalculations;
      if (sc) {
        this.extractionPriceMismatch.set({
          isPriceMatching: sc.is_price_matching === true,
          diffPercent: sc.diff_percent
        });
      } else {
        this.extractionPriceMismatch.set(null);
      }
    } catch {
      // If anything fails, just skip autopopulate; user can fill manually
    }
  }

  private parseDate(v: string): Date | null {
    if (!v || typeof v !== 'string') return null;
    const parsed = new Date(v.trim());
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  private lookupItemMetadata(itemCode: string): void {
    const normalizedItemCode = itemCode.trim();
    if (!normalizedItemCode) return;

    this.subscriptions.add(
      this.itemService.getItemByCode(normalizedItemCode).subscribe({
        next: (item) => {
          const currentDescription = String(this.shipmentForm.get('itemDescription')?.value || '').trim();
          const currentCommodity = String(this.shipmentForm.get('commodity')?.value || '').trim();
          const currentPacking = String(this.shipmentForm.get('packagingType')?.value || '').trim();
          this.shipmentForm.patchValue({
            brandName: item.brand || this.shipmentForm.get('brandName')?.value || '',
            barcode: item.barcode || this.shipmentForm.get('barcode')?.value || '',
            variant: item.variant || this.shipmentForm.get('variant')?.value || '',
            hsCode: item.hsCode || item.hs_code || this.shipmentForm.get('hsCode')?.value || '',
            countryOfOrigin: item.country_of_origin || this.shipmentForm.get('countryOfOrigin')?.value || '',
            itemDescription: currentDescription || item.item_name || '',
            commodity: currentCommodity || item.category || '',
            packagingType: currentPacking || this.getPackagingLabel(item.unit_kg)
          }, { emitEvent: false });
          this.shipmentForm.updateValueAndValidity({ emitEvent: false });
        },
        error: () => {
          // Item enrichment is optional; leave manual/extracted values untouched.
        }
      })
    );
  }

  private getPackagingLabel(unitKg?: number): string {
    if (!unitKg || !Number.isFinite(unitKg)) return '';
    return `1X${unitKg}KG`;
  }

  onSubmit(): void {
    if (this.shipmentForm.invalid || !this.hasAllRequiredDocuments()) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Validation Error',
        detail: 'Please fill all required fields and upload all 3 required documents'
      });
      return;
    }

    this.submitting.set(true);
    const formValue = this.shipmentForm.getRawValue();

    // poNumber is required by API (used for shipment number); use PO No. (fpoNo), else PI No., else generated default
    const poNumberValue =
      (formValue.fpoNo && String(formValue.fpoNo).trim()) ||
      (formValue.piNo && String(formValue.piNo).trim()) ||
      'PO-' + (formValue.purchaseDate ? new Date(formValue.purchaseDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);

    // Map form values to API payload structure
    const payload: CreateShipmentPayload = {
      poNumber: poNumberValue,
      year: new Date().getFullYear().toString(),
      orderDate: formValue.purchaseDate ? new Date(formValue.purchaseDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0], // YYYY-MM-DD
      supplierName: formValue.supplier || '',
      itemCode: formValue.itemCode || '',
      itemDescription: formValue.itemDescription || '',
      commodity: formValue.commodity || '',
      countryOfOrigin: formValue.countryOfOrigin || '',
      brandName: formValue.brandName || '',
      barcode: formValue.barcode || '',
      variant: formValue.variant || '',
      hsCode: formValue.hsCode || '',
      packing: formValue.packagingType || '',
      portOfLoading: formValue.portOfLoading || '',
      portOfDischarge: formValue.portOfDischarge || '',
      plannedQtyMT: formValue.plannedContainers?.toString() || '0',
      estimatedContainerCount: formValue.noOfShipments?.toString() || '0',
      estimatedContainerSize: formValue.containerSize || '',
      plannedETD: formValue.expectedETD ? new Date(formValue.expectedETD).toISOString().split('T')[0] : '',
      plannedETA: formValue.expectedETA ? new Date(formValue.expectedETA).toISOString().split('T')[0] : '',
      piNo: formValue.piNo || '',
      fcPerUnit: formValue.fcPerUnit?.toString() || '0',
      totalFC: formValue.totalUSD?.toString() || '0',
      amountAED: formValue.totalAED?.toString() || '0',
      advanceAmount: formValue.advanceAmount || 0,
      totalAmount: formValue.totalUSD?.toString() || '0',
      incoterms: formValue.incoTerms || '',
      buyunit: formValue.buyingUnit || '',
      paymentTerms: formValue.paymentTerms || '',
      bankName: formValue.bankName || '',
      q1Report: JSON.stringify(this.extractedQ1Report() || {}),
      splitContainers: formValue.noOfShipments?.toString() || '0',
      totalSplitQtyMT: formValue.noOfShipments?.toString() || '0'
    };

    const createFormData = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        createFormData.append(key, String(value));
      }
    });

    const lpo = this.document1File();
    const proforma = this.document2File();
    const s1 = this.s1QualityReportFile();
    if (lpo) createFormData.append('lpoDocument', lpo, lpo.name);
    if (proforma) createFormData.append('proformaDocument', proforma, proforma.name);
    if (s1) createFormData.append('s1QualityReport', s1, s1.name);

    this.shipmentService.createShipment(createFormData).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Shipment created successfully'
        });
        // Navigate to dashboard after 1 second
        setTimeout(() => {
          this.router.navigate(['/dashboard']);
        }, 1000);
      },
      error: (error) => {
        this.submitting.set(false);
        console.error('Error creating shipment:', error);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: error.error?.message || 'Failed to create shipment'
        });
      }
    });
  }
}
