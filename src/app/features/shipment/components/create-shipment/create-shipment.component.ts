import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

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
import { Item } from '../../../../core/models/item.model';
import { Supplier } from '../../../../core/models/supplier.model';
import { CreateShipmentPayload, ExtractedShipmentData } from '../../../../core/models/shipment.model';

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
export class CreateShipmentComponent implements OnInit {
  shipmentForm!: FormGroup;

  // Dropdown data from resolver (pre-loaded)
  items = signal<Item[]>([]);
  suppliers = signal<Supplier[]>([]);
  submitting = signal(false);

  // Document extraction: document1 = Purchase order, document2 = Performa Invoice
  document1File = signal<File | null>(null);
  document2File = signal<File | null>(null);
  extracting = signal(false);
  /** Set after extract & autopopulate when response includes shipment_calculations; used for price-mismatch warning. */
  extractionPriceMismatch = signal<{ isPriceMatching: boolean; diffPercent?: number } | null>(null);

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
    { label: 'EXWORKS', value: 'EXWORKS' }
  ];

  paymentTerms = [
    { label: '100% CAD', value: '100% CAD' },
    { label: 'Advance 100%', value: 'Advance 100%' },
    { label: 'DA 30 days', value: 'DA 30 days' },
    { label: '20% Advance and 80% CAD', value: '20% Advance and 80% CAD' }
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

  countries = [
    { label: 'USA', value: 'USA' },
    { label: 'China', value: 'China' },
    { label: 'Germany', value: 'Germany' },
    { label: 'Pakistan', value: 'Pakistan' },
    { label: 'India', value: 'India' }
  ];

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private shipmentService: ShipmentService,
    private messageService: MessageService,
    private router: Router,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.initForm();
    this.loadResolvedData();
    this.setupAutoFill();
  }

  private loadResolvedData(): void {
    // Get pre-loaded data from route resolver
    const formData = this.route.snapshot.data['formData'];
    if (formData) {
      this.items.set(formData.items || []);
      this.suppliers.set(formData.suppliers || []);
    }
  }

  private initForm(): void {
    this.shipmentForm = this.fb.group({
      // Shipment Info
      commodity: [null],
      piNo: [''],
      piDate: [null],
      fpoNo: [''],
      purchaseDate: [null],
      incoTerms: [null],
      portOfLoading: [''],
      portOfDischarge: [''],
      item: [null, Validators.required],
      brandName: [''],
      itemDescription: [''],

      // Supplier Details
      supplier: [null, Validators.required],
      countryOfOrigin: [null],

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
      advanceAmount: [null],
      expectedETD: [null],
      expectedETA: [null]
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
    // Auto-fill item description, brand name, and packaging type when item is selected
    this.shipmentForm.get('item')?.valueChanges.subscribe((itemId) => {
      if (itemId) {
        const selectedItem = this.items().find(item => item._id === itemId);
        if (selectedItem) {
          this.shipmentForm.patchValue({
            itemDescription: selectedItem.description,
            brandName: selectedItem.riceName || '',
            packagingType: selectedItem.packing || ''
          }, { emitEvent: false });
        }
      }
    });

    // Auto-fill country of origin when supplier is selected
    this.shipmentForm.get('supplier')?.valueChanges.subscribe((supplierId) => {
      if (supplierId) {
        const selectedSupplier = this.suppliers().find(supplier => supplier._id === supplierId);
        if (selectedSupplier) {
          this.shipmentForm.patchValue({
            countryOfOrigin: selectedSupplier.country
          }, { emitEvent: false });
        }
      }
    });
  }

  // Purchase order (document1) & Performa Invoice (document2) for extraction
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
    if (!file1 || !file2) return;

    const formData = new FormData();
    formData.append('document1', file1, file1.name);
    formData.append('document2', file2, file2.name);

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

      // Resolve supplier: match by supplierCode (case-insensitive) first, then by name (case-insensitive / contains)
      const rawCode = d['supplierCode'];
      const rawName = d['supplierName'];
      const code = typeof rawCode === 'string' ? rawCode.trim() : '';
      const name = typeof rawName === 'string' ? rawName.trim() : '';
      if (code || name) {
        const supplier = this.findSupplierByCodeOrName(code, name);
        if (supplier) {
          patch['supplier'] = supplier._id;
          // Set Country of Origin from supplier when setting supplier programmatically (valueChanges won't fire with emitEvent: false)
          patch['countryOfOrigin'] = supplier.country ?? '';
        }
      }

      // Resolve item: match by itemCode (case-insensitive) first, then by description (case-insensitive / contains)
      const rawItemCode = d['itemCode'];
      const rawDesc = d['itemDescription'];
      const itemCode = typeof rawItemCode === 'string' ? rawItemCode.trim() : '';
      const itemDesc = typeof rawDesc === 'string' ? rawDesc.trim() : '';
      if (itemCode || itemDesc) {
        const item = this.findItemByCodeOrDescription(itemCode, itemDesc);
        if (item) patch['item'] = item._id;
      }

      this.shipmentForm.patchValue(patch, { emitEvent: false });
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

  private findSupplierByCodeOrName(code: string, name: string): Supplier | undefined {
    const list = this.suppliers();
    if (!list.length) return undefined;
    const codeLower = code.toLowerCase().replace(/[\s\-_]+/g, '');
    const nameLower = name.toLowerCase();
    return list.find(s => {
      const sCode = s.supplierCode?.toLowerCase().replace(/[\s\-_]+/g, '') ?? '';
      if (codeLower && sCode && sCode === codeLower) return true;
      if (nameLower && s.name?.toLowerCase() === nameLower) return true;
      if (nameLower && s.name?.toLowerCase().includes(nameLower)) return true;
      if (nameLower && nameLower.includes(s.name?.toLowerCase() ?? '')) return true;
      return false;
    });
  }

  private findItemByCodeOrDescription(code: string, desc: string): Item | undefined {
    const list = this.items();
    if (!list.length) return undefined;
    const codeLower = code.toLowerCase().replace(/[\s\-_]+/g, '');
    const descLower = desc.toLowerCase();
    return list.find(i => {
      const iCode = i.itemCode?.toLowerCase().replace(/[\s\-_]+/g, '') ?? '';
      if (codeLower && iCode && iCode === codeLower) return true;
      if (descLower && i.description?.toLowerCase() === descLower) return true;
      if (descLower && i.description?.toLowerCase().includes(descLower)) return true;
      if (descLower && descLower.includes(i.description?.toLowerCase() ?? '')) return true;
      return false;
    });
  }

  onSubmit(): void {
    if (this.shipmentForm.invalid) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Validation Error',
        detail: 'Please fill all required fields'
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
      supplierId: formValue.supplier,
      itemId: formValue.item,
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
      splitContainers: formValue.noOfShipments?.toString() || '0',
      totalSplitQtyMT: formValue.noOfShipments?.toString() || '0'
    };

    this.shipmentService.createShipment(payload).subscribe({
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
