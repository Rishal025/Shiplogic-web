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
import { TabsModule } from 'primeng/tabs';
import { DialogModule } from 'primeng/dialog';
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

  readonly freightPreparedOptions = [
    { label: 'Yes', value: 'Yes' },
    { label: 'No', value: 'No' },
  ];

  readonly warehouseOptions = [
    { label: 'Warehouse DIC - RH006', value: 'Warehouse DIC - RH006' },
    { label: 'Warehouse Musaffah- RH001P1', value: 'Warehouse Musaffah- RH001P1' },
  ];
  readonly costSheetDescriptions = COST_SHEET_DESCRIPTIONS;

  readonly activeTabs = signal<Record<number, 'cost' | 'storage'>>({});
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
    const base = this.shipmentData()?.shipment?.shipmentNo;
    return base?.trim() ? `${base}-${index + 1}` : '–';
  }

  setActiveTab(index: number, tab: 'cost' | 'storage'): void {
    this.activeTabs.update((current) => ({ ...current, [index]: tab }));
  }

  getActiveTab(index: number): 'cost' | 'storage' {
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

  openRemoteDocumentPreview(url: string, title: string): void {
    this.previewUrl.set(url);
    this.previewTitle.set(title);
    this.previewIsImage.set(/\.(png|jpe?g|gif|webp)(\?|$)/i.test(url));
    this.showPreviewModal.set(true);
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

  onPreviewVisibleChange(visible: boolean): void {
    if (!visible) this.closeDocumentPreview();
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
      requestAmount: Number(entry.requestAmount) || 0,
      paidAmount: Number(entry.paidAmount) || 0,
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
