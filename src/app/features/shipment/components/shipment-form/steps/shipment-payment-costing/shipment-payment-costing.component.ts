import { Component, Input, computed, inject, signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { AccordionModule } from 'primeng/accordion';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
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
  previewSafeUrl = computed(() => {
    const url = this.previewUrl();
    if (!url || this.previewIsImage()) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  getShipmentNoLabel(index: number): string {
    if (this.formArray?.controls[index] == null) return '–';
    const base = this.shipmentData()?.shipment?.shipmentNo;
    return base?.trim() ? `${base}-${index + 1}` : '–';
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

  getVisiblePaymentAllocations(group: AbstractControl, shipmentIndex: number): AbstractControl[] {
    const rows = this.getPaymentAllocations(group).controls;
    return this.expandedAllocations()[shipmentIndex] ? rows : rows.slice(0, 3);
  }

  hasHiddenPaymentAllocations(group: AbstractControl): boolean {
    return this.getPaymentAllocations(group).length > 3;
  }

  togglePaymentAllocations(shipmentIndex: number): void {
    this.expandedAllocations.update((cur) => ({ ...cur, [shipmentIndex]: !cur[shipmentIndex] }));
  }

  getVisiblePaymentCostings(group: AbstractControl, shipmentIndex: number): AbstractControl[] {
    const rows = this.getPaymentCostings(group).controls;
    return this.expandedCostings()[shipmentIndex] ? rows : rows.slice(0, 3);
  }

  hasHiddenPaymentCostings(group: AbstractControl): boolean {
    return this.getPaymentCostings(group).length > 3;
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
    this.showPreviewModal.set(true);
  }

  openDocumentPreview(file: File, title: string): void {
    this.previewUrl.set(URL.createObjectURL(file));
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

  onPreviewVisibleChange(visible: boolean): void {
    if (!visible) this.closeDocumentPreview();
  }

  saveRow(index: number): void {
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

    const paymentAllocations = this.getPaymentAllocations(group).controls.map((row, rowIndex) => ({
      sn: Number(row.get('sn')?.value) || rowIndex + 1,
      description: row.get('description')?.value || '',
      requestAmount: Number(row.get('requestAmount')?.value) || 0,
      paidAmount: Number(row.get('paidAmount')?.value) || 0,
    }));

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

    const formData = new FormData();
    formData.append('paymentAllocations', JSON.stringify(paymentAllocations));
    formData.append('paymentCostings', JSON.stringify(paymentCostings));

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

  generateReport(index: number): void {
    const group = this.formArray.at(index) as FormGroup | null;
    if (!group) return;

    const shipmentNo = this.getShipmentNoLabel(index);
    const rows = this.getPaymentCostings(group).controls.map((row) => ({
      sn: row.get('sn')?.value ?? '',
      description: row.get('description')?.value ?? '',
      requestAmount: row.get('requestAmount')?.value ?? '',
      paidAmount: row.get('paidAmount')?.value ?? '',
      actualPaid: row.get('actualPaid')?.value ?? '',
      refBillNo: row.get('refBillNo')?.value ?? '',
      refBillDate: row.get('refBillDate')?.value ? new Date(row.get('refBillDate')?.value).toLocaleDateString('en-GB') : '',
      refBillVendor: row.get('refBillVendor')?.value ?? '',
    }));

    const headers = ['SN', 'Description', 'Request Amount', 'Paid Amount', 'Actual Paid', 'Ref Bill No', 'Ref Bill Date', 'Ref Bill Vendor'];
    const csvLines = [
      [`Shipment`, `"${shipmentNo}"`].join(','),
      headers.join(','),
      ...rows.map((row) =>
        [
          row.sn,
          `"${String(row.description).replace(/"/g, '""')}"`,
          row.requestAmount,
          row.paidAmount,
          row.actualPaid,
          `"${String(row.refBillNo).replace(/"/g, '""')}"`,
          `"${String(row.refBillDate).replace(/"/g, '""')}"`,
          `"${String(row.refBillVendor).replace(/"/g, '""')}"`,
        ].join(',')
      ),
    ];

    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${shipmentNo.replace(/[^a-z0-9_-]/gi, '_')}-payment-costing-report.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

}
