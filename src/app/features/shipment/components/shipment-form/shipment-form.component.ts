import { Component, OnDestroy, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormArray, FormControl } from '@angular/forms';
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
  selectSubmittedStep3Indices,
  selectSubmittedStep4Indices,
} from '../../../../store/shipment/shipment.selectors';
import * as ShipmentActions from '../../../../store/shipment/shipment.actions';

import { ShipmentSummaryComponent } from './steps/shipment-summary/shipment-summary.component';
import { ShipmentSplitComponent } from './steps/shipment-split/shipment-split.component';
import { ShipmentDocumentationComponent } from './steps/shipment-documentation/shipment-documentation.component';
import { ShipmentArrivalComponent } from './steps/shipment-arrival/shipment-arrival.component';

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
    ShipmentDocumentationComponent,
    ShipmentArrivalComponent,
  ],
  templateUrl: './shipment-form.component.html',
  styleUrls: ['./shipment-form.component.scss'],
})
export class ShipmentFormComponent implements OnDestroy {
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
  readonly submittedStep3Indices = toSignal(this.store.select(selectSubmittedStep3Indices), {
    initialValue: [],
  });
  readonly submittedStep4Indices = toSignal(this.store.select(selectSubmittedStep4Indices), {
    initialValue: [],
  });

  // Computed steps for stepper
  readonly steps = computed<Step[]>(() => {
    const total = this.totalContainers();
    return [
      { label: 'Shipment Entry', subLabel: 'Purchase', completed: true },
      { label: 'Shipment Tracker', subLabel: 'Purchase', completed: this.isPlannedLocked() },
      {
        label: 'Document Tracker',
        subLabel: 'FAS',
        completed: this.allSubmitted(total, this.submittedStep3Indices()),
      },
      {
        label: 'Shipment Clearing Tracker',
        subLabel: 'Logistics',
        completed: this.allSubmitted(total, this.submittedStep4Indices()),
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

    // Disable planned splits when locked
    effect(() => {
      if (this.isPlannedLocked()) {
        this.plannedSplits.disable({ emitEvent: false });
      }
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
      documentationSplits: this.fb.array([]),
      arrivalTimeSplits: this.fb.array([]),
      clearancePaidSplits: this.fb.array([]),
      clearanceFinalSplits: this.fb.array([]),
      grnSplits: this.fb.array([]),
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

  /** Sync planned rows from "No of Shipments" and set each row qtyMT = totalQtyMT / no. */
  syncPlannedSplitsByNoOfShipments(no: number, totalQtyMT: number): void {
    if (no <= 0 || totalQtyMT <= 0) return;
    const containerSize = this.shipmentForm.get('containerSize')?.value;
    this.plannedSplits.clear();
    const qtyPerRow = this.distributeQtyMT(totalQtyMT, no);
    for (let i = 0; i < no; i++) {
      this.plannedSplits.push(
        this.fb.group({
          size: [containerSize, Validators.required],
          qtyMT: [qtyPerRow[i], Validators.required],
          weekWiseShipment: ['', Validators.required],
          FCL: [null, Validators.required],
          etd: [null, Validators.required],
          eta: [null, Validators.required],
        })
      );
    }
    this.shipmentForm.get('noOfShipments')?.setValue(no, { emitEvent: false });
  }

  addPlannedRow(): void {
    const totalQtyMT = this.shipmentData()?.shipment?.plannedQtyMT ?? 0;
    const containerSize = this.shipmentForm.get('containerSize')?.value;
    this.plannedSplits.push(this.createPlannedGroup());
    const n = this.plannedSplits.length;
    const qtyPerRow = this.distributeQtyMT(totalQtyMT, n);
    this.plannedSplits.controls.forEach((c, i) => {
      c.get('qtyMT')?.setValue(qtyPerRow[i], { emitEvent: false });
    });
    this.shipmentForm.get('noOfShipments')?.setValue(n, { emitEvent: false });
  }

  removePlannedRow(index: number): void {
    if (this.plannedSplits.length <= 1) return;
    const totalQtyMT = this.shipmentData()?.shipment?.plannedQtyMT ?? 0;
    this.plannedSplits.removeAt(index);
    const n = this.plannedSplits.length;
    const qtyPerRow = this.distributeQtyMT(totalQtyMT, n);
    this.plannedSplits.controls.forEach((c, i) => {
      c.get('qtyMT')?.setValue(qtyPerRow[i], { emitEvent: false });
    });
    this.shipmentForm.get('noOfShipments')?.setValue(n, { emitEvent: false });
  }

  private createPlannedGroup(qtyMT?: number): FormGroup {
    return this.fb.group({
      size: [this.shipmentForm.get('containerSize')?.value, Validators.required],
      qtyMT: [qtyMT ?? null, Validators.required],
      weekWiseShipment: ['', Validators.required],
      FCL: [null, Validators.required],
      etd: [null, Validators.required],
      eta: [null, Validators.required],
    });
  }

  // --- Populate Form from API Data ---
  private populateFormWithData(data: ShipmentDetailsResponse): void {
    this.actualSplits.clear();
    this.documentationSplits.clear();
    this.arrivalTimeSplits.clear();
    this.clearancePaidSplits.clear();
    this.clearanceFinalSplits.clear();
    this.grnSplits.clear();

    // Planned splits
    if (data.planned && data.planned.length > 0) {
      this.plannedSplits.clear();
      data.planned.forEach((container) => {
        this.plannedSplits.push(
          this.fb.group({
            size: [container.size || data.shipment.containerSize, Validators.required],
            qtyMT: [container.qtyMT, Validators.required],
            weekWiseShipment: [container.weekWiseShipment, Validators.required],
            FCL: [container.FCL, Validators.required],
            etd: [container.etd ? new Date(container.etd) : null, Validators.required],
            eta: [container.eta ? new Date(container.eta) : null, Validators.required],
          })
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
          })
        );

        this.documentationSplits.push(
          this.fb.group({
            containerId: [plannedContainer.containerId],
            BLNo: [actualData?.BLNo || '', Validators.required],
            DHL: [actualData?.DHL || ''],
            expectedDocDate: [actualData?.expectedDocDate ? new Date(actualData.expectedDocDate) : null],
            receiver: [actualData?.receiver || ''],
            bankAdvanceAmount: [actualData?.bankAdvanceAmount ?? null],
            bankAdvanceSubmittedOn: [actualData?.bankAdvanceSubmittedOn ? new Date(actualData.bankAdvanceSubmittedOn) : null],
            docToBeReleasedOn: [actualData?.docToBeReleasedOn ? new Date(actualData.docToBeReleasedOn) : null],
            documentCollectedOn: [actualData?.documentCollectedOn ? new Date(actualData.documentCollectedOn) : null],
          })
        );

        this.arrivalTimeSplits.push(
          this.fb.group({
            containerId: [plannedContainer.containerId],
            shipmentArrivedOn: [
              actualData?.shipmentArrivedOn ? new Date(actualData.shipmentArrivedOn) : null,
              Validators.required,
            ],
            clearExpectedOn: [
              actualData?.clearExpectedOn ? new Date(actualData.clearExpectedOn) : null,
            ],
            clearingStatus: [actualData?.clearingStatus || null],
            deliverySchedules: this.fb.array(
              (actualData?.deliverySchedules || []).map((ds) =>
                this.fb.group({
                  date: [ds.date ? new Date(ds.date) : null],
                  noOfFCL: [ds.noOfFCL ?? null],
                  time: [ds.time || ''],
                  location: [ds.location || ''],
                })
              )
            ),
            receivedOn: [actualData?.warehouseReceivedOn ? new Date(actualData.warehouseReceivedOn) : null],
            grnNo: [actualData?.warehouseGrnNo || ''],
            qualityInspectionReportDate: [
              actualData?.qualityInspectionReportDate ? new Date(actualData.qualityInspectionReportDate) : null,
            ],
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
            clearedOn: [
              actualData?.clearance?.clearedOn
                ? new Date(actualData.clearance.clearedOn)
                : null,
              Validators.required,
            ],
            remarks: [actualData?.clearance?.remarks || '', Validators.required],
            warehouse: [actualData?.clearance?.warehouse || '', Validators.required],
          })
        );

        this.grnSplits.push(
          this.fb.group({
            containerId: [plannedContainer.containerId],
            grnNo: [actualData?.grn?.grnNo || '', Validators.required],
            grnDate: [
              actualData?.grn?.grnDate ? new Date(actualData.grn.grnDate) : null,
              Validators.required,
            ],
            statusRemarks: [actualData?.grn?.statusRemarks || '', Validators.required],
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
            FCL: planned.get('FCL')?.value,
            size: planned.get('size')?.value,
            qtyMT: planned.get('qtyMT')?.value,
            updatedETD: planned.get('etd')?.value,
            updatedETA: planned.get('eta')?.value,
          },
          { emitEvent: false }
        );
      }
      this.documentationSplits.push(this.createGroup('doc'));
      this.arrivalTimeSplits.push(this.createGroup('arrival'));
      this.clearancePaidSplits.push(this.createGroup('paid'));
      this.clearanceFinalSplits.push(this.createGroup('final'));
      this.grnSplits.push(this.createGroup('grn'));
    }
  }

  onRemoveActual(index: number): void {
    this.actualSplits.removeAt(index);
    this.documentationSplits.removeAt(index);
    this.arrivalTimeSplits.removeAt(index);
    this.clearancePaidSplits.removeAt(index);
    this.clearanceFinalSplits.removeAt(index);
    this.grnSplits.removeAt(index);
  }

  private createGroup(type: string): FormGroup {
    switch (type) {
      case 'actual':
        return this.fb.group({
          containerId: [null],
          FCL: [null],
          size: [null],
          qtyMT: [null, Validators.required],
          bags: [null, Validators.required],
          pallet: [null],
          updatedETD: [null, Validators.required],
          updatedETA: [null, Validators.required],
          BLNo: ['', Validators.required],
        });
      case 'doc':
        return this.fb.group({
          containerId: [null],
          BLNo: ['', Validators.required],
          DHL: [''],
          expectedDocDate: [null],
          receiver: [''],
          bankAdvanceAmount: [null],
          bankAdvanceSubmittedOn: [null],
          docToBeReleasedOn: [null],
          documentCollectedOn: [null],
        });
      case 'arrival':
        return this.fb.group({
          containerId: [null],
          shipmentArrivedOn: [null, Validators.required],
          clearExpectedOn: [null],
          clearingStatus: [null],
          deliverySchedules: this.fb.array([]),
          receivedOn: [null],
          grnNo: [''],
          qualityInspectionReportDate: [null],
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
          clearedOn: [null, Validators.required],
          remarks: ['', Validators.required],
          warehouse: ['', Validators.required],
        });
      case 'grn':
        return this.fb.group({
          containerId: [null],
          grnNo: ['', Validators.required],
          grnDate: [null, Validators.required],
          statusRemarks: ['', Validators.required],
        });
      default:
        return this.fb.group({});
    }
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

  ngOnDestroy(): void {
    this.store.dispatch(ShipmentActions.resetShipmentFormState());
  }
}
