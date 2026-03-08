import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';

// PrimeNG Imports (v21 matching package.json)
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';

import { PrimaryButtonDirective } from '../../../../shared/directives/button.directive';
import { ShipmentService } from '../../../../core/services/shipment.service';
import { Item } from '../../../../core/models/item.model';
import { Supplier } from '../../../../core/models/supplier.model';
import { CreateShipmentPayload } from '../../../../core/models/shipment.model';

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
  uploadedFiles = signal<File[]>([]);

  // Static Dropdown Options - Updated per requirements
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
    private router: Router
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

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    this.uploadedFiles.update(current => [...current, ...Array.from(input.files!)]);
    input.value = '';
  }

  removeFile(index: number): void {
    this.uploadedFiles.update(current => current.filter((_, i) => i !== index));
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

    // Map form values to API payload structure
    const payload: CreateShipmentPayload = {
      poNumber: '',
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
