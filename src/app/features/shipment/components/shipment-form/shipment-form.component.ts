import { Component, OnDestroy, computed, effect, inject } from '@angular/core'; // Trigger reload
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormArray, FormControl, AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';

import { SkeletonModule } from 'primeng/skeleton';
import { ButtonModule } from 'primeng/button';

import { StepperComponent, Step } from '../../../../shared/components/stepper/stepper.component';
import { ShipmentDetailsResponse } from '../../../../core/models/shipment.model';

import {
  selectShipmentLoading,
  selectCurrentStep,
  selectIsPlannedLocked,
  selectShipmentData,
  selectTotalContainers,
  selectSubmittedActualIndices,
  selectSubmittedStep3Indices,
  selectSubmittedStep4Indices,
  selectSubmittedStep5Indices,
  selectSubmittedStep6Indices,
  selectSubmittedStep7Indices,
} from '../../../../store/shipment/shipment.selectors';
import * as ShipmentActions from '../../../../store/shipment/shipment.actions';

import { ShipmentSummaryComponent } from './steps/shipment-summary/shipment-summary.component';
import { ShipmentSplitComponent } from './steps/shipment-split/shipment-split.component';
import { ShipmentBlDetailsComponent } from './steps/shipment-bl-details/shipment-bl-details.component';
import { ShipmentDocumentationComponent } from './steps/shipment-documentation/shipment-documentation.component';
import { ShipmentArrivalComponent } from './steps/shipment-arrival/shipment-arrival.component';
import { ShipmentStorageComponent } from './steps/shipment-storage/shipment-storage.component';
import { ShipmentQualityComponent } from './steps/shipment-quality/shipment-quality.component';
import { ShipmentPaymentCostingComponent } from './steps/shipment-payment-costing/shipment-payment-costing.component';

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
  selector: 'app-shipment-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    ButtonModule,
    SkeletonModule,
    StepperComponent,
    ShipmentSummaryComponent,
    ShipmentSplitComponent,
    ShipmentBlDetailsComponent,
    ShipmentDocumentationComponent,
    ShipmentArrivalComponent,
    ShipmentStorageComponent,
    ShipmentQualityComponent,
    ShipmentPaymentCostingComponent,
  ],
  templateUrl: './shipment-form.component.html',
  styleUrls: ['./shipment-form.component.scss'],
})
export class ShipmentFormComponent implements OnDestroy {
  readonly appDateFormat = 'dd/mm/yy';
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private store = inject(Store);

  shipmentForm: FormGroup;
  shipmentId: string | null = null;

  // Signals from store
  readonly loading = toSignal(this.store.select(selectShipmentLoading), { initialValue: false });
  readonly currentStep = toSignal(this.store.select(selectCurrentStep), { initialValue: 0 });
  readonly shipmentData = toSignal(this.store.select(selectShipmentData));
  readonly isPlannedLocked = toSignal(this.store.select(selectIsPlannedLocked), {
    initialValue: false,
  });
  readonly totalContainers = toSignal(this.store.select(selectTotalContainers), {
    initialValue: 0,
  });
  readonly submittedActualIndices = toSignal(this.store.select(selectSubmittedActualIndices), {
    initialValue: [],
  });
  readonly submittedStep3Indices = toSignal(this.store.select(selectSubmittedStep3Indices), {
    initialValue: [],
  });
  readonly submittedStep4Indices = toSignal(this.store.select(selectSubmittedStep4Indices), {
    initialValue: [],
  });
  readonly submittedStep5Indices = toSignal(this.store.select(selectSubmittedStep5Indices), {
    initialValue: [],
  });
  readonly submittedStep6Indices = toSignal(this.store.select(selectSubmittedStep6Indices), {
    initialValue: [],
  });
  readonly submittedStep7Indices = toSignal(this.store.select(selectSubmittedStep7Indices), {
    initialValue: [],
  });

  // Computed steps for stepper
  readonly steps = computed<Step[]>(() => {
    const total = this.totalContainers();
    return [
      { label: 'Shipment Entry', subLabel: 'Purchase', completed: true },
      { label: 'Shipment Tracker', subLabel: 'Purchase', completed: this.isPlannedLocked() },
      {
        label: 'BL Details',
        subLabel: 'Purchase',
        completed: this.allSubmitted(total, this.submittedActualIndices()),
      },
      {
        label: 'Document Tracker',
        subLabel: 'FAS',
        completed: this.allSubmitted(total, this.submittedStep3Indices()),
      },
      {
        label: 'Port and Customs Clearance Tracker',
        subLabel: 'Logistics',
        completed: this.allSubmitted(total, this.submittedStep4Indices()),
      },
      {
        label: 'Storage Allocation & Arrival',
        subLabel: 'Logistics',
        completed: this.allSubmitted(total, this.submittedStep5Indices()),
      },
      {
        label: 'Quality',
        subLabel: 'QA',
        completed: this.allSubmitted(total, this.submittedStep6Indices()),
      },
      {
        label: 'Payment & Costing',
        subLabel: 'FAS',
        completed: this.allSubmitted(total, this.submittedStep7Indices()),
      },
    ];
  });

  constructor() {
    this.shipmentForm = this.buildForm();

    // Repopulate reactive form when API data arrives
    effect(() => {
      const data = this.shipmentData();
      if (data) this.populateFormWithData(data);
    });

    // Load shipment on route param
    this.route.params.subscribe((params) => {
      const id = params['id'];
      if (id) {
        this.shipmentId = id;
        this.store.dispatch(ShipmentActions.loadShipmentDetail({ id }));
      }
    });
  }

  getDisplayShipmentNo(): string {
    const shipmentNo = this.shipmentForm.get('shipmentNo')?.value;
    return typeof shipmentNo === 'string' ? shipmentNo.replace(/\([^)]*\)/g, '').trim() : '';
  }

  // --- Form Accessors ---
  get plannedSplits(): FormArray {
    return this.shipmentForm.get('plannedSplits') as FormArray;
  }
  get actualSplits(): FormArray {
    return this.shipmentForm.get('actualSplits') as FormArray;
  }
  get noOfShipmentsFormControl(): FormControl<number | null> {
    return this.shipmentForm.get('noOfShipments') as FormControl<number | null>;
  }
  get documentationSplits(): FormArray {
    return this.shipmentForm.get('documentationSplits') as FormArray;
  }
  get blDetailsSplits(): FormArray {
    return this.shipmentForm.get('blDetailsSplits') as FormArray;
  }
  get arrivalTimeSplits(): FormArray {
    return this.shipmentForm.get('arrivalTimeSplits') as FormArray;
  }
  get clearancePaidSplits(): FormArray {
    return this.shipmentForm.get('clearancePaidSplits') as FormArray;
  }
  get clearanceFinalSplits(): FormArray {
    return this.shipmentForm.get('clearanceFinalSplits') as FormArray;
  }
  get grnSplits(): FormArray {
    return this.shipmentForm.get('grnSplits') as FormArray;
  }
  get storageSplits(): FormArray {
    return this.shipmentForm.get('storageSplits') as FormArray;
  }

  // --- Form Init ---
  private buildForm(): FormGroup {
    const form = this.fb.group({
      shipmentNo: ['', Validators.required],
      piNo: [''],
      fpoNo: [''],
      incoTerms: [''],
      item: [null],
      itemDescription: [''],
      supplier: [null],
      countryOfOrigin: [null],
      packagingType: [null],
      containerSize: [''],
      buyingUnit: [null],
      plannedContainers: [null],
      fcPerUnit: [null],
      estimatedTotalFC: [{ value: null as number | null, disabled: true }],
      paymentTerms: [null],
      advanceAmount: [null],
      expectedETD: [null],
      expectedETA: [null],
      noOfShipments: [null as number | null],
      plannedSplits: this.fb.array([]),
      actualSplits: this.fb.array([]),
      blDetailsSplits: this.fb.array([]),
      documentationSplits: this.fb.array([]),
      arrivalTimeSplits: this.fb.array([]),
      clearancePaidSplits: this.fb.array([]),
      clearanceFinalSplits: this.fb.array([]),
      grnSplits: this.fb.array([]),
      storageSplits: this.fb.array([]),
    }, {
      validators: this.dateOrderValidator('expectedETD', 'expectedETA', 'etaBeforeEtd'),
    });

    form.valueChanges.subscribe((val) => {
      const containers = val.plannedContainers as number | null;
      const fcPerUnit = val.fcPerUnit as number | null;
      if (containers != null && fcPerUnit != null) {
        form
          .get('estimatedTotalFC')
          ?.setValue(containers * fcPerUnit, { emitEvent: false });
      }
    });

    return form;
  }

  // --- Sync Planned Splits ---
  private syncPlannedSplits(count: number): void {
    const current = this.plannedSplits.length;
    if (count > current) {
      for (let i = current; i < count; i++) {
        this.plannedSplits.push(this.createPlannedGroup());
      }
    } else if (count < current) {
      for (let i = current; i > count; i--) {
        this.plannedSplits.removeAt(i - 1);
      }
    }
  }

  /** Distribute totalQtyMT across n rows (equal split, sum never exceeds total). */
  private distributeQtyMT(totalQtyMT: number, n: number): number[] {
    if (n <= 0) return [];
    const perRow = totalQtyMT / n;
    const rows: number[] = [];
    let sum = 0;
    for (let i = 0; i < n - 1; i++) {
      const v = Math.floor(perRow * 100) / 100;
      rows.push(v);
      sum += v;
    }
    rows.push(Math.round((totalQtyMT - sum) * 100) / 100);
    return rows;
  }

  /**
   * Distribute shipment-level FCL across n rows using whole numbers only.
   * The remainder is assigned to the last row so no row gets a decimal.
   */
  private distributeFcl(totalFcl: number, n: number): number[] {
    if (n <= 0 || totalFcl <= 0) return Array.from({ length: n }, () => 0);
    const base = Math.ceil(totalFcl / n);
    const rows: number[] = [];
    let allocated = 0;

    for (let i = 0; i < n; i++) {
      const remainingRows = n - i;
      const remainingFcl = totalFcl - allocated;
      const nextValue = remainingRows === 1 ? remainingFcl : Math.min(base, remainingFcl);
      rows.push(nextValue);
      allocated += nextValue;
    }

    return rows;
  }

  /** Sync planned rows from "No of Shipments" and set each row qtyMT = totalQtyMT / no. */
  syncPlannedSplitsByNoOfShipments(no: number, totalQtyMT: number): void {
    if (no <= 0 || totalQtyMT <= 0) return;
    this.plannedSplits.clear();
    const qtyPerRow = this.distributeQtyMT(totalQtyMT, no);
    const totalFcl = Number(this.shipmentData()?.shipment?.fcl) || 0;
    const fclPerRow = this.distributeFcl(totalFcl, no);
    for (let i = 0; i < no; i++) {
      this.plannedSplits.push(this.createPlannedGroup(qtyPerRow[i], false, fclPerRow[i]));
    }
    this.shipmentForm.get('noOfShipments')?.setValue(no, { emitEvent: false });
  }

  addPlannedRow(): void {
    const totalQtyMT = this.shipmentData()?.shipment?.plannedQtyMT ?? 0;
    const totalFcl = Number(this.shipmentData()?.shipment?.fcl) || 0;
    this.plannedSplits.push(this.createPlannedGroup(undefined, true));
    const n = this.plannedSplits.length;
    const qtyPerRow = this.distributeQtyMT(totalQtyMT, n);
    const fclPerRow = this.distributeFcl(totalFcl, n);
    this.plannedSplits.controls.forEach((c, i) => {
      c.get('qtyMT')?.setValue(qtyPerRow[i], { emitEvent: false });
      c.get('FCL')?.setValue(fclPerRow[i], { emitEvent: false });
    });
    this.shipmentForm.get('noOfShipments')?.setValue(n, { emitEvent: false });
  }

  removePlannedRow(index: number): void {
    if (this.plannedSplits.length <= 1) return;
    const row = this.plannedSplits.at(index) as FormGroup | null;
    const isManualRow = !!row?.get('isManualRow')?.value;
    if (!isManualRow) return;
    const totalQtyMT = this.shipmentData()?.shipment?.plannedQtyMT ?? 0;
    const totalFcl = Number(this.shipmentData()?.shipment?.fcl) || 0;
    this.plannedSplits.removeAt(index);
    const n = this.plannedSplits.length;
    const qtyPerRow = this.distributeQtyMT(totalQtyMT, n);
    const fclPerRow = this.distributeFcl(totalFcl, n);
    this.plannedSplits.controls.forEach((c, i) => {
      c.get('qtyMT')?.setValue(qtyPerRow[i], { emitEvent: false });
      c.get('FCL')?.setValue(fclPerRow[i], { emitEvent: false });
    });
    this.shipmentForm.get('noOfShipments')?.setValue(n, { emitEvent: false });
  }

  private createPlannedGroup(qtyMT?: number, isManualRow = false, fcl?: number): FormGroup {
    return this.fb.group({
      size: [this.shipmentForm.get('containerSize')?.value, Validators.required],
      qtyMT: [qtyMT ?? null, Validators.required],
      weekWiseShipment: ['', Validators.required],
      FCL: [fcl ?? null, Validators.required],
      etd: [null, Validators.required],
      eta: [null, Validators.required],
      isManualRow: [isManualRow],
    }, { validators: this.dateOrderValidator('etd', 'eta', 'etaBeforeEtd') });
  }

  // --- Populate Form from API Data ---
  private populateFormWithData(data: ShipmentDetailsResponse): void {
    this.actualSplits.clear();
    this.blDetailsSplits.clear();
    this.documentationSplits.clear();
    this.arrivalTimeSplits.clear();
    this.clearancePaidSplits.clear();
    this.clearanceFinalSplits.clear();
    this.grnSplits.clear();
    this.storageSplits.clear();

    // Planned splits
    if (data.planned && data.planned.length > 0) {
      this.plannedSplits.clear();
      const expectedPlannedRows =
        typeof (data.shipment as { noOfShipments?: number }).noOfShipments === 'number' &&
        (data.shipment as { noOfShipments?: number }).noOfShipments! > 0
          ? Math.min(
              data.planned.length,
              Number((data.shipment as { noOfShipments?: number }).noOfShipments)
            )
          : data.planned.length;
      data.planned.slice(0, expectedPlannedRows).forEach((container) => {
        this.plannedSplits.push(
          this.fb.group({
            size: [container.size || data.shipment.containerSize, Validators.required],
            qtyMT: [container.qtyMT, Validators.required],
            weekWiseShipment: [container.weekWiseShipment, Validators.required],
            FCL: [container.FCL, Validators.required],
            etd: [container.etd ? new Date(container.etd) : null, Validators.required],
            eta: [container.eta ? new Date(container.eta) : null, Validators.required],
            isManualRow: [false],
          }, { validators: this.dateOrderValidator('etd', 'eta', 'etaBeforeEtd') })
        );
      });
    }

    // Step 1 fields and noOfShipments (for step 2 Scheduled)
    const noOfShipmentsValue = (data.shipment as { noOfShipments?: number }).noOfShipments ?? (data.planned?.length ?? 0);
    this.shipmentForm.patchValue(
      {
        shipmentNo: data.shipment.shipmentNo,
        piNo: data.shipment.piNo,
        supplier: data.shipment.supplier,
        item: data.shipment.item,
        plannedContainers: data.shipment.assumedContainerCount,
        noOfShipments: noOfShipmentsValue || null,
        incoTerms: data.shipment.incoterms,
        buyingUnit: data.shipment.buyunit,
        fcPerUnit: data.shipment.fcPerUnit,
        paymentTerms: data.shipment.paymentTerms,
        advanceAmount: data.shipment.advanceAmount,
        containerSize: data.shipment.containerSize,
      },
      { emitEvent: false }
    );

    // Build actual + linked step arrays
    if (data.planned && data.planned.length > 0) {
      data.planned.forEach((plannedContainer) => {
        const actualData = data.actual?.find(
          (a) => a.containerId === plannedContainer.containerId
        );

        this.actualSplits.push(
          this.fb.group({
            containerId: [plannedContainer.containerId],
            actualSerialNo: [actualData?.actualSerialNo || `${this.actualSplits.length + 1}`],
            commercialInvoiceNo: [actualData?.commercialInvoiceNo || ''],
            shipOnBoardDate: [actualData?.shipOnBoardDate ? new Date(actualData.shipOnBoardDate) : null, Validators.required],
            portOfLoading: [actualData?.portOfLoading || ''],
            portOfDischarge: [actualData?.portOfDischarge || ''],
            noOfContainers: [actualData?.noOfContainers ?? null],
            noOfBags: [actualData?.noOfBags ?? null],
            quantityByMt: [actualData?.quantityByMt ?? null],
            shippingLine: [actualData?.shippingLine || ''],
            freeDetentionDays: [actualData?.freeDetentionDays ?? null],
            maximumDetentionDays: [actualData?.maximumDetentionDays ?? null],
            freightPrepared: [actualData?.freightPrepared || 'No'],
            billExtractionData: [actualData?.billExtractionData || null],
            extractedContainers: [actualData?.extractedContainers || []],
            FCL: [plannedContainer.FCL ?? null],
            size: [plannedContainer.size ?? data.shipment.containerSize ?? null],
            qtyMT: [
              actualData?.qtyMT ?? plannedContainer.qtyMT ?? null,
              Validators.required,
            ],
            bags: [actualData?.bags ?? null, Validators.required],
            pallet: [actualData?.pallet ?? null],
            updatedETD: [
              actualData?.updatedETD
                ? new Date(actualData.updatedETD)
                : plannedContainer.etd
                  ? new Date(plannedContainer.etd)
                  : null,
              Validators.required,
            ],
            updatedETA: [
              actualData?.updatedETA
                ? new Date(actualData.updatedETA)
                : plannedContainer.eta
                  ? new Date(plannedContainer.eta)
                  : null,
              Validators.required,
            ],
            BLNo: [actualData?.BLNo || '', Validators.required],
          }, { validators: this.actualDateOrderValidator() })
        );

        this.documentationSplits.push(
          this.fb.group({
            containerId: [plannedContainer.containerId],
            BLNo: [actualData?.BLNo || '', Validators.required],
            courierTrackNo: [actualData?.courierTrackNo || actualData?.DHL || ''],
            courierServiceProvider: [actualData?.courierServiceProvider || ''],
            expectedDocDate: [actualData?.expectedDocDate ? new Date(actualData.expectedDocDate) : null],
            receiver: [actualData?.receiver || '', Validators.required],
            bankName: [actualData?.bankName || ''],
            inwardCollectionAdviceDate: [actualData?.inwardCollectionAdviceDate ? new Date(actualData.inwardCollectionAdviceDate) : null],
            inwardCollectionAdviceDocumentUrl: [actualData?.inwardCollectionAdviceDocumentUrl || ''],
            inwardCollectionAdviceDocumentName: [actualData?.inwardCollectionAdviceDocumentName || ''],
            murabahaContractReleasedDate: [actualData?.murabahaContractReleasedDate ? new Date(actualData.murabahaContractReleasedDate) : null],
            murabahaContractApprovedDate: [actualData?.murabahaContractApprovedDate ? new Date(actualData.murabahaContractApprovedDate) : null],
            murabahaContractSubmittedDate: [actualData?.murabahaContractSubmittedDate ? new Date(actualData.murabahaContractSubmittedDate) : null],
            murabahaContractSubmittedDocumentUrl: [actualData?.murabahaContractSubmittedDocumentUrl || ''],
            murabahaContractSubmittedDocumentName: [actualData?.murabahaContractSubmittedDocumentName || ''],
            documentsReleasedDate: [actualData?.documentsReleasedDate ? new Date(actualData.documentsReleasedDate) : null],
            documentsReleasedDocumentUrl: [actualData?.documentsReleasedDocumentUrl || ''],
            documentsReleasedDocumentName: [actualData?.documentsReleasedDocumentName || ''],
          }, { validators: this.documentationBankValidator() })
        );

        this.blDetailsSplits.push(this.createBlDetailsGroup(plannedContainer, actualData, data, this.actualSplits.length - 1));

        const containerCount = Math.max(1, Number(plannedContainer?.FCL ?? 1) || 1);
        const extractedContainerSource =
          actualData?.extractedContainers?.length
            ? actualData.extractedContainers
            : actualData?.billExtractionData?.containers || [];
        const shipmentNo = data.shipment?.shipmentNo || '';
        const existingTransportationBooked =
          (actualData as any)?.transportationBooked ||
          (actualData as any)?.transportContainers ||
          [];

        this.arrivalTimeSplits.push(
          this.fb.group({
            containerId: [plannedContainer.containerId],
            arrivalOn: [actualData?.arrivalOn ? new Date(actualData.arrivalOn) : null],
            shipmentFreeRetentionDate: [actualData?.shipmentFreeRetentionDate ? new Date(actualData.shipmentFreeRetentionDate) : null],
            portRetentionWithPenaltyDate: [actualData?.portRetentionWithPenaltyDate ? new Date(actualData.portRetentionWithPenaltyDate) : null],
            maximumRetentionDate: [actualData?.maximumRetentionDate ? new Date(actualData.maximumRetentionDate) : null],
            arrivalNoticeDate: [actualData?.arrivalNoticeDate ? new Date(actualData.arrivalNoticeDate) : null],
            arrivalNoticeFreeRetentionDays: [actualData?.arrivalNoticeFreeRetentionDays ?? null],
            arrivalNoticeDocumentUrl: [actualData?.arrivalNoticeDocumentUrl || ''],
            arrivalNoticeDocumentName: [actualData?.arrivalNoticeDocumentName || ''],
            advanceRequestDate: [actualData?.advanceRequestDate ? new Date(actualData.advanceRequestDate) : null],
            advanceRequestDocumentUrl: [actualData?.advanceRequestDocumentUrl || ''],
            advanceRequestDocumentName: [actualData?.advanceRequestDocumentName || ''],
            doReleasedDate: [
              (actualData as any)?.doReleasedDate
                ? new Date((actualData as any).doReleasedDate)
                : null,
            ],
            doReleasedDocumentUrl: [actualData?.doReleasedDocumentUrl || ''],
            doReleasedDocumentName: [actualData?.doReleasedDocumentName || ''],
            doReleasedRemarks: [(actualData as any)?.doReleasedRemarks || ''],
            dpApprovalDate: [actualData?.dpApprovalDate ? new Date(actualData.dpApprovalDate) : null],
            dpApprovalDocumentUrl: [actualData?.dpApprovalDocumentUrl || ''],
            dpApprovalDocumentName: [actualData?.dpApprovalDocumentName || ''],
            dpApprovalRemarks: [actualData?.dpApprovalRemarks || ''],
            customsClearanceDate: [actualData?.customsClearanceDate ? new Date(actualData.customsClearanceDate) : null],
            customsClearanceDocumentUrl: [actualData?.customsClearanceDocumentUrl || ''],
            customsClearanceDocumentName: [actualData?.customsClearanceDocumentName || ''],
            customsClearanceRemarks: [actualData?.customsClearanceRemarks || ''],
            tokenReceivedDate: [
              (actualData as any)?.tokenReceivedDate
                ? new Date((actualData as any).tokenReceivedDate)
                : actualData?.tokenDate
                  ? new Date(actualData.tokenDate)
                  : null,
            ],
            municipalityDate: [
              (actualData as any)?.municipalityDate
                ? new Date((actualData as any).municipalityDate)
                : actualData?.municipalityClearanceDate
                  ? new Date(actualData.municipalityClearanceDate)
                  : null,
            ],
            municipalityDocumentUrl: [actualData?.municipalityDocumentUrl || ''],
            municipalityDocumentName: [actualData?.municipalityDocumentName || ''],
            municipalityRemarks: [
              (actualData as any)?.municipalityRemarks ||
              actualData?.municipalityClearanceRemarks ||
              '',
            ],
            transportationBooked: this.createTransportationBookedRows(
              containerCount,
              this.actualSplits.length - 1,
              existingTransportationBooked,
              extractedContainerSource
            ),
          })
        );

        this.clearancePaidSplits.push(
          this.fb.group({
            containerId: [plannedContainer.containerId],
            paid_amount: [actualData?.paid_amount ?? null, Validators.required],
            paidOn: [
              actualData?.paidOn ? new Date(actualData.paidOn) : null,
              Validators.required,
            ],
            remarks: [actualData?.remarks || '', Validators.required],
          })
        );

        this.clearanceFinalSplits.push(
          this.fb.group({
            containerId: [plannedContainer.containerId],
            paymentAllocations: this.createPaymentAllocationRows(
              (actualData as any)?.paymentAllocations?.length
                ? (actualData as any).paymentAllocations
                : (actualData as any)?.costSheetBookings
            ),
            paymentCostings: this.createPaymentCostingRows(
              (actualData as any)?.paymentCostings,
              (actualData as any)?.paymentAllocations?.length
                ? (actualData as any).paymentAllocations
                : (actualData as any)?.costSheetBookings
            ),
            packagingExpenses: this.createPackagingExpenseRows((actualData as any)?.packagingExpenses),
            paymentCostingDocumentUrl: [(actualData as any)?.paymentCostingDocumentUrl || ''],
            paymentCostingDocumentName: [(actualData as any)?.paymentCostingDocumentName || ''],
          })
        );

        this.grnSplits.push(
          this.fb.group({
            containerId: [plannedContainer.containerId],
            qualityRows: this.createQualityRows((actualData as any)?.qualityRows, (actualData as any)?.qualityReports),
            qualityReports: this.createQualityReportRows((actualData as any)?.qualityReports),
          })
        );
        
        // 1 storageSplits entry per planned split, with N containers inside.
        // Prefer saved extracted containers from BL/bill extraction over FCL count.
        const existingStorageSplits = actualData?.storageSplits || [];
        const existingStorageAllocations = actualData?.storageAllocations || [];
        const storageExtractedContainerSource =
          actualData?.extractedContainers?.length
            ? actualData.extractedContainers
            : actualData?.billExtractionData?.containers || [];
        const storageContainerCount = Math.max(1, storageExtractedContainerSource.length || containerCount);

        const containersArray = this.fb.array(
          Array.from({ length: storageContainerCount }, (_, c) => {
            const existingStorage = existingStorageSplits[c];
            const existingAllocation = existingStorageAllocations[c];
            const extractedContainer = storageExtractedContainerSource[c];
            const containerLabel =
              existingStorage?.containerSerialNo ||
              existingAllocation?.containerSerialNo ||
              extractedContainer?.containerNo ||
              `${shipmentNo}-C${c + 1}`;
            return this.fb.group({
              containerSerialNo: [containerLabel],
              bags: [existingStorage?.bags ?? existingAllocation?.bags ?? extractedContainer?.pkgCt ?? (extractedContainer as any)?.pkg_ct ?? null],
              warehouse: [existingStorage?.warehouse || existingAllocation?.warehouse || ''],
              storageAvailability: [existingStorage?.storageAvailability ?? existingAllocation?.storageAvailability ?? null],
              receivedOnDate: [existingStorage?.receivedOnDate ? new Date(existingStorage.receivedOnDate) : null],
              receivedOnTime: [this.parseTimeValue(existingStorage?.receivedOnTime)],
              customsInspection: [existingStorage?.customsInspection || 'Yes'],
              grn: [existingStorage?.grn || ''],
              batch: [existingStorage?.batch || ''],
              productionDate: [existingStorage?.productionDate ? new Date(existingStorage.productionDate) : null],
              expiryDate: [existingStorage?.expiryDate ? new Date(existingStorage.expiryDate) : null],
              remarks: [existingStorage?.remarks || ''],
              documentUrl: [existingStorage?.documentUrl || ''],
              documentName: [existingStorage?.documentName || ''],
            });
          })
        );

        this.storageSplits.push(
          this.fb.group({
            containerId: [plannedContainer.containerId],
            noOfContainers: [storageContainerCount],
            storageDocumentUrl: [actualData?.storageDocumentUrl || ''],
            storageDocumentName: [actualData?.storageDocumentName || ''],
            containers: containersArray,
          })
        );
      });
    }
  }

  // --- Child Event Handlers ---
  onConfirmNoOfShipments(no: number): void {
    const totalQtyMT = this.shipmentData()?.shipment?.plannedQtyMT ?? 0;
    if (no > 0 && totalQtyMT > 0) {
      this.syncPlannedSplitsByNoOfShipments(no, totalQtyMT);
    }
  }

  onAddActual(): void {
    const max = this.shipmentForm.get('plannedContainers')?.value || 0;
    if (this.actualSplits.length < max) {
      this.actualSplits.push(this.createGroup('actual'));
      const idx = this.actualSplits.length - 1;
      const planned = this.plannedSplits.at(idx);
      if (planned) {
        this.actualSplits.at(idx).patchValue(
          {
            actualSerialNo: `${idx + 1}`,
            FCL: planned.get('FCL')?.value,
            size: planned.get('size')?.value,
            qtyMT: planned.get('qtyMT')?.value,
            shipOnBoardDate: null,
            updatedETD: planned.get('etd')?.value,
            updatedETA: planned.get('eta')?.value,
          },
          { emitEvent: false }
        );
      }
      this.blDetailsSplits.push(this.createGroup('bl'));
      this.documentationSplits.push(this.createGroup('doc'));
      const plannedContainerCount = Math.max(1, Number(planned?.get('FCL')?.value ?? 1) || 1);
      this.arrivalTimeSplits.push(this.createGroup('arrival', idx, plannedContainerCount));
      this.clearancePaidSplits.push(this.createGroup('paid'));
      this.clearanceFinalSplits.push(this.createGroup('final'));
      this.grnSplits.push(this.createGroup('grn'));
      this.storageSplits.push(this.createGroup('storage'));
    }
  }

  onRemoveActual(index: number): void {
    this.actualSplits.removeAt(index);
    this.blDetailsSplits.removeAt(index);
    this.documentationSplits.removeAt(index);
    this.arrivalTimeSplits.removeAt(index);
    this.clearancePaidSplits.removeAt(index);
    this.clearanceFinalSplits.removeAt(index);
    this.grnSplits.removeAt(index);
    this.storageSplits.removeAt(index);
  }

  private createGroup(type: string, shipmentIndex = 0, containerCount = 1): FormGroup {
    switch (type) {
      case 'actual':
        return this.fb.group({
          containerId: [null],
          actualSerialNo: [''],
          commercialInvoiceNo: [''],
          shipOnBoardDate: [null, Validators.required],
          portOfLoading: [''],
          portOfDischarge: [''],
          noOfContainers: [null],
          noOfBags: [null],
          quantityByMt: [null],
          shippingLine: [''],
          freeDetentionDays: [null],
          maximumDetentionDays: [null],
          freightPrepared: ['No'],
          billExtractionData: [null],
          extractedContainers: [[]],
          FCL: [null],
          size: [null],
          qtyMT: [null, Validators.required],
          bags: [null, Validators.required],
          pallet: [null],
          updatedETD: [null, Validators.required],
          updatedETA: [null, Validators.required],
          BLNo: ['', Validators.required],
        }, { validators: this.actualDateOrderValidator() });
      case 'doc':
        return this.fb.group({
          containerId: [null],
          BLNo: ['', Validators.required],
          courierTrackNo: [''],
          courierServiceProvider: [''],
          expectedDocDate: [null],
          receiver: ['', Validators.required],
          bankName: [''],
          inwardCollectionAdviceDate: [null],
          inwardCollectionAdviceDocumentUrl: [''],
          inwardCollectionAdviceDocumentName: [''],
          murabahaContractReleasedDate: [null],
          murabahaContractApprovedDate: [null],
          murabahaContractSubmittedDate: [null],
          murabahaContractSubmittedDocumentUrl: [''],
          murabahaContractSubmittedDocumentName: [''],
          documentsReleasedDate: [null],
          documentsReleasedDocumentUrl: [''],
          documentsReleasedDocumentName: [''],
        }, { validators: this.documentationBankValidator() });
      case 'bl':
        return this.createBlDetailsGroup();
      case 'arrival':
        return this.fb.group({
          containerId: [null],
          arrivalOn: [null],
          shipmentFreeRetentionDate: [null],
          portRetentionWithPenaltyDate: [null],
          maximumRetentionDate: [null],
          arrivalNoticeDate: [null],
          arrivalNoticeFreeRetentionDays: [null],
          arrivalNoticeDocumentUrl: [''],
          arrivalNoticeDocumentName: [''],
          advanceRequestDate: [null],
          advanceRequestDocumentUrl: [''],
          advanceRequestDocumentName: [''],
          doReleasedDate: [null],
          doReleasedDocumentUrl: [''],
          doReleasedDocumentName: [''],
          doReleasedRemarks: [''],
          dpApprovalDate: [null],
          dpApprovalDocumentUrl: [''],
          dpApprovalDocumentName: [''],
          dpApprovalRemarks: [''],
          customsClearanceDate: [null],
          customsClearanceDocumentUrl: [''],
          customsClearanceDocumentName: [''],
          customsClearanceRemarks: [''],
          tokenReceivedDate: [null],
          municipalityDate: [null],
          municipalityDocumentUrl: [''],
          municipalityDocumentName: [''],
          municipalityRemarks: [''],
          transportationBooked: this.createTransportationBookedRows(containerCount, shipmentIndex),
        });
      case 'paid':
        return this.fb.group({
          containerId: [null],
          paid_amount: [null, Validators.required],
          paidOn: [null, Validators.required],
          remarks: ['', Validators.required],
        });
      case 'final':
        return this.fb.group({
          containerId: [null],
          paymentAllocations: this.createPaymentAllocationRows(),
          paymentCostings: this.createPaymentCostingRows(),
          packagingExpenses: this.createPackagingExpenseRows(),
          paymentCostingDocumentUrl: [''],
          paymentCostingDocumentName: [''],
        });
      case 'grn':
        return this.fb.group({
          containerId: [null],
          qualityRows: this.createQualityRows(),
          qualityReports: this.createQualityReportRows([]),
        });
      case 'storage':
        return this.fb.group({
          containerId: [null],
          noOfContainers: [containerCount],
          storageDocumentUrl: [''],
          storageDocumentName: [''],
          containers: this.fb.array(
            Array.from({ length: Math.max(1, containerCount) }, (_, c) =>
              this.fb.group({
                containerSerialNo: [`SHIPMENT-${shipmentIndex + 1}-C${c + 1}`],
                bags: [null],
                warehouse: [''],
                storageAvailability: [null],
                receivedOnDate: [null],
                receivedOnTime: [null],
                customsInspection: ['Yes'],
                grn: [''],
                batch: [''],
                productionDate: [null],
                expiryDate: [null],
                remarks: [''],
                documentUrl: [''],
                documentName: [''],
              })
            )
          ),
        });
      default:
        return this.fb.group({});
    }
  }

  private createBlDetailsGroup(
    plannedContainer?: any,
    actualData?: any,
    data?: ShipmentDetailsResponse,
    shipmentIndex = 0
  ): FormGroup {
    const extractedContainerSource =
      actualData?.extractedContainers?.length
        ? actualData.extractedContainers
        : actualData?.billExtractionData?.containers || [];
    const noOfContainers =
      Number(
        actualData?.noOfContainers ??
        extractedContainerSource?.length ??
        plannedContainer?.FCL ??
        actualData?.FCL ??
        1
      ) || 1;
    return this.fb.group({
      containerId: [plannedContainer?.containerId ?? null],
      blNo: [actualData?.BLNo || ''],
      shippedOnBoard: [actualData?.shipOnBoardDate ? new Date(actualData.shipOnBoardDate) : null],
      portOfLoading: [actualData?.portOfLoading || ''],
      portOfDischarge: [actualData?.portOfDischarge || ''],
      noOfContainers: [noOfContainers],
      noOfBags: [actualData?.noOfBags ?? actualData?.bags ?? null],
      quantityByMt: [actualData?.quantityByMt ?? actualData?.qtyMT ?? plannedContainer?.qtyMT ?? null],
      shippingLine: [actualData?.shippingLine || ''],
      freeDetentionDays: [actualData?.freeDetentionDays ?? null],
      maximumDetentionDays: [actualData?.maximumDetentionDays ?? null],
      freightPrepared: [actualData?.freightPrepared || 'No'],
      blDocumentUrl: [actualData?.blDocumentUrl || ''],
      blDocumentName: [actualData?.blDocumentName || ''],
      costSheetBookingDocumentUrl: [actualData?.costSheetBookingDocumentUrl || ''],
      costSheetBookingDocumentName: [actualData?.costSheetBookingDocumentName || ''],
      costSheetBookings: this.createCostSheetBookingRows(actualData?.costSheetBookings),
      storageAllocations: this.createStorageAllocationRows(
        noOfContainers,
        shipmentIndex,
        actualData?.storageAllocations,
        extractedContainerSource
      ),
    });
  }

  private createCostSheetBookingRows(existingRows?: any[]): FormArray {
    const existingMap = new Map(
      (existingRows || []).map((row) => [Number(row.sn) || 0, row])
    );
    return this.fb.array(
      COST_SHEET_DESCRIPTIONS.map((description, index) =>
        this.fb.group({
          sn: [index + 1],
          description: [description],
          requestAmount: [existingMap.get(index + 1)?.requestAmount ?? null],
          paidAmount: [existingMap.get(index + 1)?.paidAmount ?? null],
        })
      )
    );
  }

  private createStorageAllocationRows(count: number, shipmentIndex: number, existingRows?: any[], extractedContainers?: any[]): FormArray {
    const rows = new FormArray<FormGroup>([]);
    const safeCount = Math.max(1, extractedContainers?.length || count || 1);
    const shipmentNo = this.shipmentData()?.shipment?.shipmentNo || 'SHIPMENT';
    for (let i = 0; i < safeCount; i++) {
      const existing = existingRows?.[i];
      const extracted = extractedContainers?.[i];
      rows.push(
        this.fb.group({
          sn: [existing?.sn ?? i + 1],
          containerSerialNo: [
            existing?.containerSerialNo ||
            extracted?.containerNo ||
            extracted?.container_no ||
            `${shipmentNo}-${shipmentIndex + 1}-C${i + 1}`
          ],
          bags: [existing?.bags ?? extracted?.pkgCt ?? extracted?.pkg_ct ?? ''],
          warehouse: [existing?.warehouse || ''],
          storageAvailability: [existing?.storageAvailability ?? ''],
        })
      );
    }
    return rows;
  }

  private createTransportationBookedRows(
    count: number,
    shipmentIndex: number,
    existingRows: any[] = [],
    extractedContainers?: any[]
  ): FormArray {
    const rows = new FormArray<FormGroup>([]);
    const safeCount = Math.max(1, extractedContainers?.length || count || 1);
    const shipmentNo = this.shipmentData()?.shipment?.shipmentNo || 'SHIPMENT';
    for (let i = 0; i < safeCount; i++) {
      const existing = existingRows[i];
      const extracted = extractedContainers?.[i];
      rows.push(
        this.fb.group({
          sn: [i + 1],
          containerSerialNo: [
            existing?.containerSerialNo ||
            extracted?.containerNo ||
            extracted?.container_no ||
            `${shipmentNo}-${shipmentIndex + 1}-C${i + 1}`
          ],
          transportCompanyName: [existing?.transportCompanyName || ''],
          bookedDate: [existing?.bookedDate ? new Date(existing.bookedDate) : null],
          bookingTime: [this.parseTimeValue(existing?.bookingTime)],
          transportDate: [existing?.transportDate ? new Date(existing.transportDate) : null],
          transportTime: [this.parseTimeValue(existing?.transportTime)],
          delayHours: [existing?.delayHours ?? null],
        })
      );
    }
    return rows;
  }

  private createQualityRows(existingRows: any[] = [], existingReports: any[] = []): FormArray {
    const source = existingRows.length > 0 ? existingRows : [{}];
    return this.fb.array(
      source.map((row: any, index: number) => {
        const fallbackReport = existingReports[index] || {};
        return (
        this.fb.group({
          sn: [row?.sn ?? index + 1],
          sampleNo: [row?.sampleNo || ''],
          phase: [row?.phase || 'S1'],
          date: [row?.date ? new Date(row.date) : null],
          inhouseReportNo: [row?.inhouseReportNo || ''],
          inhouseReportDate: [row?.inhouseReportDate ? new Date(row.inhouseReportDate) : null],
          inhouseReportDocumentUrl: [row?.inhouseReportDocumentUrl || ''],
          inhouseReportDocumentName: [row?.inhouseReportDocumentName || ''],
          strategicReportNo: [row?.strategicReportNo || ''],
          strategicReportDate: [row?.strategicReportDate ? new Date(row.strategicReportDate) : null],
          strategicReportDocumentUrl: [row?.strategicReportDocumentUrl || ''],
          strategicReportDocumentName: [row?.strategicReportDocumentName || ''],
          thirdPartyReportNo: [row?.thirdPartyReportNo || ''],
          thirdPartyReportDate: [row?.thirdPartyReportDate ? new Date(row.thirdPartyReportDate) : null],
          thirdPartyReportDocumentUrl: [row?.thirdPartyReportDocumentUrl || ''],
          thirdPartyReportDocumentName: [row?.thirdPartyReportDocumentName || ''],
          remarks: [row?.remarks || fallbackReport?.remarks || ''],
          attachmentDocumentUrl: [row?.attachmentDocumentUrl || fallbackReport?.documentUrl || ''],
          attachmentDocumentName: [row?.attachmentDocumentName || fallbackReport?.documentName || ''],
        })
      );
      })
    );
  }

  private parseTimeValue(value: unknown): Date | null {
    if (!value || typeof value !== 'string') return null;
    const [hours, minutes] = value.split(':').map((part) => Number(part));
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  private createQualityReportRows(existingRows: any[] = []): FormArray {
    const source = existingRows.length > 0 ? existingRows : [{}];
    return this.fb.array(
      source.map((row: any) =>
        this.fb.group({
          phase: [row?.phase || 'S1'],
          reportDate: [row?.reportDate ? new Date(row.reportDate) : null],
          remarks: [row?.remarks || ''],
          documentUrl: [row?.documentUrl || ''],
          documentName: [row?.documentName || ''],
        })
      )
    );
  }

  private createPaymentAllocationRows(existingRows: any[] = []): FormArray {
    const source =
      existingRows.length > 0
        ? COST_SHEET_DESCRIPTIONS.map((description, index) => {
            const existing = existingRows[index];
            return {
              sn: existing?.sn ?? index + 1,
              description: existing?.description || description,
              requestAmount: existing?.requestAmount ?? null,
              paidAmount: existing?.paidAmount ?? null,
              reference: existing?.reference ?? '',
            };
          })
        : COST_SHEET_DESCRIPTIONS.map((description, index) => ({
            sn: index + 1,
            description,
            requestAmount: null,
            paidAmount: null,
            reference: '',
          }));
    return this.fb.array(
      source.map((row: any, index: number) =>
        this.fb.group({
          sn: [row?.sn ?? index + 1],
          description: [row?.description || ''],
          requestAmount: [row?.requestAmount ?? null],
          paidAmount: [row?.paidAmount ?? null],
          reference: [row?.reference ?? ''],
        })
      )
    );
  }

  private createPaymentCostingRows(existingRows: any[] = [], seedRows: any[] = []): FormArray {
    const source =
      existingRows.length > 0
        ? COST_SHEET_DESCRIPTIONS.map((description, index) => {
            const existing = existingRows[index];
            return {
              sn: existing?.sn ?? index + 1,
              description: existing?.description || description,
              requestAmount: existing?.requestAmount ?? null,
              paidAmount: existing?.paidAmount ?? null,
              actualPaid: existing?.actualPaid ?? null,
              refBillNo: existing?.refBillNo ?? '',
              refBillDate: existing?.refBillDate ?? null,
              refBillVendor: existing?.refBillVendor ?? '',
              refBillDocumentUrl: existing?.refBillDocumentUrl ?? '',
              refBillDocumentName: existing?.refBillDocumentName ?? '',
            };
          })
        : seedRows.length > 0
          ? COST_SHEET_DESCRIPTIONS.map((description, index) => {
              const seeded = seedRows[index];
              return {
                sn: seeded?.sn ?? index + 1,
                description: seeded?.description || description,
                requestAmount: seeded?.requestAmount ?? null,
                paidAmount: seeded?.paidAmount ?? null,
                actualPaid: null,
                refBillNo: '',
                refBillDate: null,
                refBillVendor: '',
                refBillDocumentUrl: '',
                refBillDocumentName: '',
              };
            })
        : COST_SHEET_DESCRIPTIONS.map((description, index) => ({
            sn: index + 1,
            description,
            requestAmount: null,
            paidAmount: null,
            actualPaid: null,
            refBillNo: '',
            refBillDate: null,
            refBillVendor: '',
            refBillDocumentUrl: '',
            refBillDocumentName: '',
          }));
    return this.fb.array(
      source.map((row: any, index: number) =>
        this.fb.group({
          sn: [row?.sn ?? index + 1],
          description: [row?.description || ''],
          requestAmount: [row?.requestAmount ?? null],
          paidAmount: [row?.paidAmount ?? null],
          actualPaid: [row?.actualPaid ?? null],
          refBillNo: [row?.refBillNo || ''],
          refBillDate: [row?.refBillDate ? new Date(row.refBillDate) : null],
          refBillVendor: [row?.refBillVendor || ''],
          refBillDocumentUrl: [row?.refBillDocumentUrl || ''],
          refBillDocumentName: [row?.refBillDocumentName || ''],
        })
      )
    );
  }

  private createPackagingExpenseRows(existingRows: any[] = []): FormArray {
    const source = existingRows.length > 0
      ? existingRows
      : [{
          sn: 1,
          item: '',
          packing: '',
          qty: null,
          uom: '',
          unitCostFC: null,
          unitCostDH: null,
          totalCostFC: null,
          totalCostDH: null,
          expenseAllocationFactor: null,
          expensesAllocated: null,
          totalValueWithExpenses: null,
          landedCostPerUnit: null,
          reference: '',
        }];

    return this.fb.array(
      source.map((row: any, index: number) =>
        this.fb.group({
          sn: [row?.sn ?? index + 1],
          item: [row?.item || ''],
          packing: [row?.packing || ''],
          qty: [row?.qty ?? null],
          uom: [row?.uom || ''],
          unitCostFC: [row?.unitCostFC ?? null],
          unitCostDH: [row?.unitCostDH ?? null],
          totalCostFC: [row?.totalCostFC ?? null],
          totalCostDH: [row?.totalCostDH ?? null],
          expenseAllocationFactor: [row?.expenseAllocationFactor ?? null],
          expensesAllocated: [row?.expensesAllocated ?? null],
          totalValueWithExpenses: [row?.totalValueWithExpenses ?? null],
          landedCostPerUnit: [row?.landedCostPerUnit ?? null],
          reference: [row?.reference || ''],
        })
      )
    );
  }

  // --- Navigation ---
  onStepChange(step: number): void {
    this.store.dispatch(ShipmentActions.setCurrentStep({ step }));
    if (this.shipmentId) {
      this.store.dispatch(ShipmentActions.loadShipmentDetail({ id: this.shipmentId }));
    }
  }

  nextStep(): void {
    const next = this.currentStep() + 1;
    if (next < this.steps().length) {
      this.store.dispatch(ShipmentActions.setCurrentStep({ step: next }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  prevStep(): void {
    const prev = this.currentStep() - 1;
    if (prev >= 0) {
      this.store.dispatch(ShipmentActions.setCurrentStep({ step: prev }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // --- Helpers ---
  private allSubmitted(total: number, indices: number[]): boolean {
    if (total === 0) return false;
    for (let i = 0; i < total; i++) {
      if (!indices.includes(i)) return false;
    }
    return true;
  }

  private dateOrderValidator(startControlName: string, endControlName: string, errorKey: string): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const startValue = control.get(startControlName)?.value;
      const endValue = control.get(endControlName)?.value;
      if (!startValue || !endValue) return null;

      const startDate = new Date(startValue);
      const endDate = new Date(endValue);

      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        return null;
      }

      return endDate <= startDate ? { [errorKey]: true } : null;
    };
  }

  private actualDateOrderValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const shipOnBoardDate = control.get('shipOnBoardDate')?.value;
      const etd = control.get('updatedETD')?.value;
      const eta = control.get('updatedETA')?.value;

      const shipDate = shipOnBoardDate ? new Date(shipOnBoardDate) : null;
      const etdDate = etd ? new Date(etd) : null;
      const etaDate = eta ? new Date(eta) : null;

      if (shipDate && etdDate && etdDate <= shipDate) {
        return { etdBeforeShipOnBoard: true };
      }

      if (shipDate && etaDate && etaDate <= shipDate) {
        return { etaBeforeShipOnBoard: true };
      }

      if (etdDate && etaDate && etaDate <= etdDate) {
        return { etaBeforeEtd: true };
      }

      return null;
    };
  }

  private documentationBankValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const receiver = control.get('receiver')?.value;
      if (receiver !== 'Bank') return null;

      const requiredFields = [
        'bankName',
        'inwardCollectionAdviceDate',
        'murabahaContractReleasedDate',
        'murabahaContractApprovedDate',
        'murabahaContractSubmittedDate',
        'documentsReleasedDate',
      ];

      const missing = requiredFields.some((field) => !control.get(field)?.value);
      return missing ? { missingBankDocumentFields: true } : null;
    };
  }

  ngOnDestroy(): void {
    this.store.dispatch(ShipmentActions.resetShipmentFormState());
  }
}
