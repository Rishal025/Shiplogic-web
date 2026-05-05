import { Component, Input, inject, effect, signal, computed, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormArray, AbstractControl } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { ConfirmationService, MessageService } from 'primeng/api';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { AccordionModule } from 'primeng/accordion';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { ShipmentService } from '../../../../../../core/services/shipment.service';
import { NotificationService } from '../../../../../../core/services/notification.service';
import { ConfirmDialogService } from '../../../../../../core/services/confirm-dialog.service';
import { TransportationCompanyService } from '../../../../../../core/services/transportation-company.service';
import { AuthService } from '../../../../../../core/services/auth.service';
import { RbacService } from '../../../../../../core/services/rbac.service';
import {
  selectShipmentData,
  selectSubmittedStep3Indices,
  selectSubmittedStep4Indices,
  selectSubmittedStep5Indices,
  selectSubmittingRowIndex,
} from '../../../../../../store/shipment/shipment.selectors';
import * as ShipmentActions from '../../../../../../store/shipment/shipment.actions';

type Step5DocKind =
  | 'arrivalNotice'
  | 'advanceRequest'
  | 'doReleased'
  | 'dpApproval'
  | 'customsClearance'
  | 'municipality';

type LogisticsSectionKey = Step5DocKind | 'transportation';

const STEP5_DOC_CONFIG: {
  kind: Step5DocKind;
  label: string;
  dateControl: string;
  remarksControl?: string;
}[] = [
  { kind: 'arrivalNotice', label: 'Arrival Notice Date', dateControl: 'arrivalNoticeDate' },
  { kind: 'advanceRequest', label: 'Advance Received', dateControl: 'advanceRequestDate' },
  { kind: 'doReleased', label: 'DO Released Date', dateControl: 'doReleasedDate', remarksControl: 'doReleasedRemarks' },
  { kind: 'dpApproval', label: 'DP Clearance Date', dateControl: 'dpApprovalDate', remarksControl: 'dpApprovalRemarks' },
  { kind: 'customsClearance', label: 'Customs Clearance Date', dateControl: 'customsClearanceDate', remarksControl: 'customsClearanceRemarks' },
  { kind: 'municipality', label: 'Municipality Check Date', dateControl: 'municipalityDate', remarksControl: 'municipalityRemarks' },
];

@Component({
  selector: 'app-shipment-arrival',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputTextModule,
    InputNumberModule,
    DatePickerModule,
    AccordionModule,
    ConfirmDialogModule,
    DialogModule,
    SelectModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './shipment-arrival.component.html',
})
export class ShipmentArrivalComponent {
  @Input({ required: true }) formArray!: FormArray;
  @Input() visibleShipmentIndices: number[] = [];

  readonly step5DocConfig = STEP5_DOC_CONFIG;
  readonly secondaryStep5DocConfig = STEP5_DOC_CONFIG.filter((doc) => doc.kind !== 'arrivalNotice');
  readonly visibleSecondaryStep5DocConfig = computed(() =>
    this.secondaryStep5DocConfig.filter((doc) => this.canViewLogisticsSection(doc.kind))
  );
  readonly visibleBulkSections = computed<LogisticsSectionKey[]>(() =>
    ([
      'arrivalNotice',
      'advanceRequest',
      'doReleased',
      'dpApproval',
      'customsClearance',
      'municipality',
      'transportation',
    ] as LogisticsSectionKey[]).filter((section) => this.canViewLogisticsSection(section))
  );

  hasPendingEditableBulkSections(index: number): boolean {
    return this.visibleBulkSections().some(
      (section) => this.canEditLogisticsSection(section) && !this.isLogisticsSectionLocked(index, section)
    );
  }

  @ViewChild('arrivalNoticeInput') arrivalNoticeInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('advanceRequestInput') advanceRequestInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('doReleasedInput') doReleasedInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('dpApprovalInput') dpApprovalInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('customsClearanceInput') customsClearanceInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('municipalityInput') municipalityInputRef?: ElementRef<HTMLInputElement>;

  private pendingFileRow: number | null = null;
  private pendingDocKind: Step5DocKind | null = null;
  private restoredUiStateKey: string | null = null;

  readonly shipmentData = toSignal(inject(Store).select(selectShipmentData));

  readonly arrivalNoticeFile = signal<Record<number, File | null>>({});
  readonly advanceRequestFile = signal<Record<number, File | null>>({});
  readonly doReleasedFile = signal<Record<number, File | null>>({});
  readonly dpApprovalFile = signal<Record<number, File | null>>({});
  readonly customsClearanceFile = signal<Record<number, File | null>>({});
  readonly municipalityFile = signal<Record<number, File | null>>({});

  readonly expandedTransportation = signal<Record<number, boolean>>({});
  readonly extractingArrivalNoticeRowIndex = signal<number | null>(null);
  readonly sectionSavingKey = signal<string | null>(null);
  readonly lockedSections = signal<Record<string, boolean>>({});

  hasVisibleShipments(): boolean {
    return this.visibleShipmentIndices.length > 0;
  }

  shouldShowShipment(index: number): boolean {
    return this.visibleShipmentIndices.includes(index);
  }
  readonly lockedPortCustomsSections = signal<Record<number, boolean>>({});
  readonly lockedTransportationSections = signal<Record<number, boolean>>({});
  readonly openAccordionPanels = signal<string[]>([]);

  // POINT 11: Bulk save modal state
  readonly bulkSaveModalVisible = signal(false);
  readonly bulkSaveRowIndex = signal<number | null>(null);
  readonly bulkSaving = signal(false);

  openBulkSaveModal(index: number): void {
    this.bulkSaveRowIndex.set(index);
    this.bulkSaveModalVisible.set(true);
  }

  closeBulkSaveModal(): void {
    this.bulkSaveModalVisible.set(false);
    this.bulkSaveRowIndex.set(null);
  }

  private normalizeAccordionValues(values: string | string[] | null | undefined): string[] {
    if (Array.isArray(values)) return values.filter(Boolean);
    if (typeof values === 'string' && values.trim()) return [values];
    return [];
  }

  private getUiStateStorageKey(): string | null {
    const shipmentId = this.shipmentData()?.shipment?._id;
    return shipmentId ? `shipment-arrival-ui:${shipmentId}` : null;
  }

  private persistUiState(): void {
    if (typeof window === 'undefined') return;
    const key = this.getUiStateStorageKey();
    if (!key) return;
    window.sessionStorage.setItem(
      key,
      JSON.stringify({ openAccordionPanels: this.normalizeAccordionValues(this.openAccordionPanels()) })
    );
  }

  private restoreUiState(): void {
    if (typeof window === 'undefined') return;
    const key = this.getUiStateStorageKey();
    if (!key || this.restoredUiStateKey === key) return;

    this.restoredUiStateKey = key;
    const rawState = window.sessionStorage.getItem(key);
    if (!rawState) return;

    try {
      const parsed = JSON.parse(rawState) as { openAccordionPanels?: string[] | null };
      this.openAccordionPanels.set(this.normalizeAccordionValues(parsed.openAccordionPanels));
    } catch {
      window.sessionStorage.removeItem(key);
    }
  }

  onAccordionChange(values: string | string[] | null | undefined): void {
    const normalized = this.normalizeAccordionValues(values);
    if (normalized.length === 0 && (this.sectionSavingKey() !== null || this.submittingRowIndex() !== null)) {
      return;
    }
    this.openAccordionPanels.set(normalized);
    this.persistUiState();
  }

  private ensureAccordionOpen(index: number): void {
    const panelValue = `arr-${index}`;
    const current = this.normalizeAccordionValues(this.openAccordionPanels());
    if (!current.includes(panelValue)) {
      this.openAccordionPanels.set([...current, panelValue]);
      this.persistUiState();
    }
  }

  async executeBulkSave(index: number): Promise<void> {
    const pendingSections = this.visibleBulkSections().filter(
      (section) => this.canEditLogisticsSection(section) && !this.isLogisticsSectionLocked(index, section)
    );

    if (pendingSections.length === 0) {
      this.messageService.add({ severity: 'info', summary: 'Nothing to save', detail: 'All sections are already saved.' });
      this.closeBulkSaveModal();
      return;
    }

    this.bulkSaving.set(true);
    const group = this.formArray.at(index);
    const containerId = group?.get('containerId')?.value;
    const shipmentId = this.shipmentData()?.shipment?._id;
    if (!group || !containerId || !shipmentId) {
      this.bulkSaving.set(false);
      return;
    }
    this.ensureAccordionOpen(index);

    if (pendingSections.includes('transportation')) {
      const transportationRows = this.getTransportationRows(group);
      transportationRows.markAllAsTouched();
      if (transportationRows.invalid) {
        this.bulkSaving.set(false);
        this.messageService.add({
          severity: 'warn',
          summary: 'Invalid transportation timing',
          detail: 'Transportation date and time must be the same as or later than the arranged date and booking time.',
        });
        return;
      }
    }

    const payload = this.buildBulkLogisticsPayload(index, pendingSections);

    this.shipmentService.submitLogistics(containerId, payload).subscribe({
      next: () => {
        this.lockedSections.update((current) => {
          const next = { ...current };
          pendingSections.forEach((section) => {
            next[this.sectionKey(index, section)] = true;
          });
          return next;
        });
        this.applySectionLocks(index);
        this.bulkSaving.set(false);
        this.closeBulkSaveModal();
        this.store.dispatch(ShipmentActions.loadShipmentDetail({ id: shipmentId }));
        this.messageService.add({
          severity: 'success',
          summary: 'Bulk Save Complete',
          detail: `${pendingSections.length} section(s) saved successfully.`,
        });
      },
      error: (error) => {
        this.bulkSaving.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Bulk Save Failed',
          detail: error?.error?.message || 'Unable to save all Port & Customs sections in one request.',
        });
      }
    });
  }

  private buildBulkLogisticsPayload(index: number, sections: LogisticsSectionKey[]): FormData {
    const group = this.formArray.at(index);
    const payload = new FormData();
    const toDate = (val: unknown) => (val ? new Date(val as Date).toISOString().split('T')[0] : '');

    payload.append('sectionKey', 'bulk');
    payload.append('bulkSectionKeys', JSON.stringify(sections));

    if (sections.includes('arrivalNotice')) {
      this.updateDerivedDates(index);
      payload.append('arrivalOn', toDate(group.get('arrivalOn')?.value));
      payload.append('shipmentFreeRetentionDate', toDate(group.get('shipmentFreeRetentionDate')?.value));
      payload.append('portRetentionWithPenaltyDate', toDate(group.get('portRetentionWithPenaltyDate')?.value));
      payload.append('maximumRetentionDate', toDate(group.get('maximumRetentionDate')?.value));
      payload.append('arrivalNoticeDate', toDate(group.get('arrivalNoticeDate')?.value));
      payload.append('arrivalNoticeFreeRetentionDays', String(group.get('arrivalNoticeFreeRetentionDays')?.value ?? ''));
      const file = this.getFile(index, 'arrivalNotice');
      if (file) payload.append('arrivalNoticeDocument', file, file.name);
    }

    const sectionMap = {
      advanceRequest: { date: 'advanceRequestDate', remarks: null as string | null, file: 'advanceRequestDocument' },
      doReleased: { date: 'doReleasedDate', remarks: 'doReleasedRemarks', file: 'doReleasedDocument' },
      dpApproval: { date: 'dpApprovalDate', remarks: 'dpApprovalRemarks', file: 'dpApprovalDocument' },
      customsClearance: { date: 'customsClearanceDate', remarks: 'customsClearanceRemarks', file: 'customsClearanceDocument' },
      municipality: { date: 'municipalityDate', remarks: 'municipalityRemarks', file: 'municipalityDocument' },
    } as const;

    (['advanceRequest', 'doReleased', 'dpApproval', 'customsClearance', 'municipality'] as const).forEach((section) => {
      if (!sections.includes(section)) return;
      const config = sectionMap[section];
      payload.append(config.date, toDate(group.get(config.date)?.value));
      if (config.remarks) {
        payload.append(config.remarks, group.get(config.remarks)?.value || '');
      }
      if (section === 'customsClearance') {
        payload.append('tokenReceivedDate', toDate(group.get('tokenReceivedDate')?.value));
      }
      const file = this.getFile(index, section);
      if (file) payload.append(config.file, file, file.name);
    });

    if (sections.includes('transportation')) {
      const transportationRows = this.getTransportationRows(group);
      transportationRows.markAllAsTouched();
      this.updateDelayHours(index);
      const transportationBooked = transportationRows.getRawValue().map((tb: any) => ({
        containerSerialNo: tb.containerSerialNo || '',
        transportCompanyName: tb.transportCompanyName || '',
        bookedDate: toDate(tb.bookedDate),
        bookingTime: this.toTimeString(tb.bookingTime),
        transportDate: toDate(tb.transportDate),
        transportTime: this.toTimeString(tb.transportTime),
        delayHours: tb.delayHours ?? null,
      }));
      payload.append('transportationBooked', JSON.stringify(transportationBooked));
    }

    return payload;
  }

  readonly extractionMessages = [
    'Uploading Arrival Notice safely',
    'Royal AI is identifying the vessel and date',
    'Extracting free retention data and detention terms',
    'Syncing extraction results with shipment records'
  ];
  readonly extractionMessageIndex = signal(0);
  readonly extractionProgress = signal(18);
  readonly currentExtractionMessage = computed(() => this.extractionMessages[this.extractionMessageIndex()] || this.extractionMessages[0]);
  private extractionTicker: any = null;

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

  private store = inject(Store);
  private sanitizer = inject(DomSanitizer);
  private shipmentService = inject(ShipmentService);
  private confirmationService = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private notificationService = inject(NotificationService);
  private confirmDialog = inject(ConfirmDialogService);
  private transportationCompanyService = inject(TransportationCompanyService);
  private authService = inject(AuthService);
  private rbacService = inject(RbacService);
  private readonly logisticsPermissionMap: Record<LogisticsSectionKey, { view: string; edit: string }> = {
    arrivalNotice: { view: 'shipment.tab.port_customs.milestone_1.view', edit: 'shipment.tab.port_customs.milestone_1.edit' },
    advanceRequest: { view: 'shipment.tab.port_customs.milestone_2.view', edit: 'shipment.tab.port_customs.milestone_2.edit' },
    doReleased: { view: 'shipment.tab.port_customs.milestone_3.view', edit: 'shipment.tab.port_customs.milestone_3.edit' },
    dpApproval: { view: 'shipment.tab.port_customs.milestone_4.view', edit: 'shipment.tab.port_customs.milestone_4.edit' },
    customsClearance: { view: 'shipment.tab.port_customs.milestone_5.view', edit: 'shipment.tab.port_customs.milestone_5.edit' },
    municipality: { view: 'shipment.tab.port_customs.milestone_6.view', edit: 'shipment.tab.port_customs.milestone_6.edit' },
    transportation: { view: 'shipment.tab.port_customs.transportation.view', edit: 'shipment.tab.port_customs.transportation.edit' },
  };

  /** Options for the Transport Company Name dropdown */
  readonly transportCompanyOptions = signal<Array<{ label: string; value: string }>>([]);

  /**
   * A row is considered "fully submitted" (locked for editing) only when
   * Storage Allocation & Arrival (step 5) has been completed for that row.
   * Until then, Port & Customs sections remain editable.
   */
  readonly submittedIndices = toSignal(this.store.select(selectSubmittedStep5Indices), { initialValue: [] });
  readonly precedingIndices = toSignal(this.store.select(selectSubmittedStep3Indices), { initialValue: [] });
  readonly submittingRowIndex = toSignal(this.store.select(selectSubmittingRowIndex), { initialValue: null });

  constructor() {
    effect(() => {
      const indices = this.submittedIndices();
      if (!this.formArray) return;
      indices.forEach((idx) => {
        if (!this.formArray.at(idx)) return;
        if (this.canOverrideSubmittedLocks()) {
          this.formArray.at(idx).enable({ emitEvent: false });
          return;
        }
        this.formArray.at(idx).disable({ emitEvent: false });
      });
    });

    // Load active transportation companies for the dropdown
    this.transportationCompanyService.getAll().subscribe({
      next: (companies) => {
        const options = companies
          .filter((c) => c.status === 'Active')
          .map((c) => ({ label: c.name, value: c.name }));
        this.transportCompanyOptions.set(options);
      },
    });

    effect(() => {
      const data = this.shipmentData();
      if (!data || !this.formArray) return;
      
      // 1. Sync all locks first in one atomic update
      this.syncAllSectionLocks();
      
      // 2. Perform updates that don't depend on lockedSections signal
      this.formArray.controls.forEach((_, index) => {
        this.updateDerivedDates(index);
        this.updateDelayHours(index);
        this.setTransportationDefaults(index);
      });
    });

    effect(() => {
      // 3. Apply locks to form controls whenever lockedSections OR submittedIndices change
      this.lockedSections(); 
      this.submittedIndices();
      if (!this.formArray) return;
      this.formArray.controls.forEach((_, index) => {
        this.applySectionLocks(index);
        this.setTransportationDefaults(index);
      });
    });

    effect(() => {
      const shipmentId = this.shipmentData()?.shipment?._id;
      if (!shipmentId || !this.formArray) return;
      this.restoreUiState();
    });
  }

  private setTransportationDefaults(index: number): void {
    const group = this.formArray.at(index);
    if (!group) return;
    const transportation = this.getTransportationRows(group);
    if (!transportation) return;

    const now = new Date();
    transportation.controls.forEach((row) => {
      if (!row.get('bookedDate')?.value) {
        row.get('bookedDate')?.patchValue(now, { emitEvent: false });
      }
      if (!row.get('bookingTime')?.value) {
        row.get('bookingTime')?.patchValue(now, { emitEvent: false });
      }
      if (!row.get('transportDate')?.value) {
        row.get('transportDate')?.patchValue(now, { emitEvent: false });
      }
      if (!row.get('transportTime')?.value) {
        row.get('transportTime')?.patchValue(now, { emitEvent: false });
      }
    });
  }

  ngOnDestroy(): void {
    this.stopExtractionExperience();
  }

  private startExtractionExperience(): void {
    this.stopExtractionExperience();
    this.extractionMessageIndex.set(0);
    this.extractionProgress.set(18);
    this.extractionTicker = setInterval(() => {
      this.extractionMessageIndex.update((index) => (index + 1) % this.extractionMessages.length);
      this.extractionProgress.update((value) => {
        if (value >= 88) return 26;
        return value + 12;
      });
    }, 1600);
  }

  private stopExtractionExperience(): void {
    if (this.extractionTicker) {
      clearInterval(this.extractionTicker);
      this.extractionTicker = null;
    }
  }

  getShipmentNoLabel(index: number): string {
    if (this.formArray?.controls[index] == null) return '–';
    const base = this.shipmentData()?.shipment?.shipmentNo?.replace(/\([^)]*\)/g, '').trim();
    return base?.trim() ? `${base}-${index + 1}` : '–';
  }

  isRowSubmitted(index: number): boolean {
    return this.submittedIndices().includes(index);
  }

  private canOverrideSubmittedLocks(): boolean {
    return this.authService.isAdminLevelRole();
  }

  /**
   * Returns true if the user has explicit view + edit permission for this section.
   * This overrides the row-level submitted lock for that specific section.
   */
  private hasSectionPermission(section: LogisticsSectionKey): boolean {
    const permission = this.logisticsPermissionMap[section];
    return !!permission &&
      this.rbacService.hasPermission(permission.view) &&
      this.rbacService.hasPermission(permission.edit);
  }

  canViewLogisticsSection(section: LogisticsSectionKey): boolean {
    if (this.canOverrideSubmittedLocks()) return true;
    const permission = this.logisticsPermissionMap[section];
    return permission ? this.rbacService.hasPermission(permission.view) : false;
  }

  canEditLogisticsSection(section: LogisticsSectionKey): boolean {
    if (this.canOverrideSubmittedLocks()) return true;
    return this.hasSectionPermission(section);
  }

  getLogisticsSectionLabel(section: LogisticsSectionKey): string {
    return section === 'arrivalNotice'
      ? 'Port & Customs Clearance'
      : section === 'advanceRequest'
        ? 'Advance Received'
        : section === 'doReleased'
          ? 'DO Released'
          : section === 'dpApproval'
            ? 'DP Clearance'
            : section === 'customsClearance'
              ? 'Customs Clearance'
              : section === 'municipality'
                ? 'Municipality Check'
                : 'Transportation Arranged';
  }

  isRowEditLocked(index: number): boolean {
    return this.isRowSubmitted(index) && !this.canOverrideSubmittedLocks();
  }

  /**
   * Returns true if the edit button/action for a specific section should be disabled.
   * If the user has explicit view+edit permission for the section, the row-level
   * submitted lock is bypassed for that section.
   */
  isSectionEditLocked(index: number, section: LogisticsSectionKey): boolean {
    if (this.hasSectionPermission(section)) return false;
    return this.isRowEditLocked(index);
  }

  isPrecedingSubmitted(index: number): boolean {
    return this.isDocumentTrackerComplete(index) || this.precedingIndices().includes(index);
  }

  private isDocumentTrackerComplete(index: number): boolean {
    const shipment = this.shipmentData()?.actual?.[index];
    if (!shipment) return false;

    const isBankReceiver = String(shipment.receiver || '').trim().toLowerCase() === 'bank';
    const milestones = isBankReceiver
      ? ['courier', 'receiving', 'inward', 'murabaha_process', 'murabaha_submit', 'release']
      : ['courier', 'receiving', 'release'];

    return milestones.every((milestone) => this.isDocumentTrackerMilestoneSaved(shipment, milestone));
  }

  private isDocumentTrackerMilestoneSaved(shipment: any, milestone: string): boolean {
    switch (milestone) {
      case 'courier':
        return !!(shipment.courierTrackNo || shipment.courierServiceProvider || shipment.docArrivalNotes);
      case 'receiving':
        return !!(shipment.expectedDocDate || (shipment.receiver && shipment.bankName));
      case 'inward':
        return !!(shipment.inwardCollectionAdviceDate || shipment.inwardCollectionAdviceDocumentUrl);
      case 'murabaha_process':
        return !!(shipment.murabahaContractReleasedDate || shipment.murabahaContractApprovedDate);
      case 'murabaha_submit':
        return !!(shipment.murabahaContractSubmittedDate || shipment.murabahaContractSubmittedDocumentUrl);
      case 'release':
        return !!(shipment.documentsReleasedDate || shipment.documentsReleasedDocumentUrl);
      default:
        return false;
    }
  }

  getTransportationRows(group: AbstractControl): FormArray {
    return group.get('transportationBooked') as FormArray;
  }

  getTransportationContainerCount(group: AbstractControl): number {
    return this.getTransportationRows(group).length;
  }

  getVisibleTransportationRows(group: AbstractControl, index: number): AbstractControl[] {
    const rows = this.getTransportationRows(group).controls;
    return this.expandedTransportation()[index] ? rows : rows.slice(0, 5);
  }

  hasHiddenTransportationRows(group: AbstractControl): boolean {
    return this.getTransportationRows(group).length > 5;
  }

  toggleTransportation(index: number): void {
    this.expandedTransportation.update((cur) => ({ ...cur, [index]: !cur[index] }));
  }

  getFileSignal(kind: Step5DocKind) {
    switch (kind) {
      case 'arrivalNotice':
        return this.arrivalNoticeFile;
      case 'advanceRequest':
        return this.advanceRequestFile;
      case 'doReleased':
        return this.doReleasedFile;
      case 'dpApproval':
        return this.dpApprovalFile;
      case 'customsClearance':
        return this.customsClearanceFile;
      case 'municipality':
        return this.municipalityFile;
    }
  }

  getFile(containerIndex: number, kind: Step5DocKind): File | null {
    return this.getFileSignal(kind)()?.[containerIndex] ?? null;
  }

  clickFileInput(index: number, kind: Step5DocKind): void {
    if (this.isRowEditLocked(index)) return;
    this.pendingFileRow = index;
    this.pendingDocKind = kind;

    const refs: Record<Step5DocKind, ElementRef<HTMLInputElement> | undefined> = {
      arrivalNotice: this.arrivalNoticeInputRef,
      advanceRequest: this.advanceRequestInputRef,
      doReleased: this.doReleasedInputRef,
      dpApproval: this.dpApprovalInputRef,
      customsClearance: this.customsClearanceInputRef,
      municipality: this.municipalityInputRef,
    };
    refs[kind]?.nativeElement?.click();
  }

  onFileInputChange(event: Event, kind: Step5DocKind): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    const row = this.pendingFileRow;
    if (row !== null && this.pendingDocKind === kind && file) {
      this.getFileSignal(kind).update((cur) => ({ ...cur, [row]: file }));
      if (kind === 'arrivalNotice') {
        this.extractArrivalNotice(row, file);
      }
    }
    this.pendingFileRow = null;
    this.pendingDocKind = null;
    input.value = '';
  }

  clearFile(containerIndex: number, kind: Step5DocKind): void {
    this.getFileSignal(kind).update((cur) => ({ ...cur, [containerIndex]: null }));
  }

  getSavedFileUrl(group: AbstractControl, kind: Step5DocKind): string {
    const map = {
      arrivalNotice: 'arrivalNoticeDocumentUrl',
      advanceRequest: 'advanceRequestDocumentUrl',
      doReleased: 'doReleasedDocumentUrl',
      dpApproval: 'dpApprovalDocumentUrl',
      customsClearance: 'customsClearanceDocumentUrl',
      municipality: 'municipalityDocumentUrl',
    } as const;
    return group.get(map[kind])?.value || '';
  }

  getSavedFileName(group: AbstractControl, kind: Step5DocKind): string {
    const map = {
      arrivalNotice: 'arrivalNoticeDocumentName',
      advanceRequest: 'advanceRequestDocumentName',
      doReleased: 'doReleasedDocumentName',
      dpApproval: 'dpApprovalDocumentName',
      customsClearance: 'customsClearanceDocumentName',
      municipality: 'municipalityDocumentName',
    } as const;
    return group.get(map[kind])?.value || '';
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

  onArrivalDateChange(index: number): void {
    this.updateDerivedDates(index);
  }

  onTransportationTimeChange(index: number): void {
    const group = this.formArray.at(index);
    if (!group) return;
    const transportation = this.getTransportationRows(group);
    
    transportation.controls.forEach((row) => {
      const bookedDate = row.get('bookedDate')?.value;
      const transportDate = row.get('transportDate')?.value;
      
      if (bookedDate && transportDate) {
        const bd = new Date(bookedDate);
        bd.setHours(0, 0, 0, 0);
        const td = new Date(transportDate);
        td.setHours(0, 0, 0, 0);
        
        if (td < bd) {
          this.notificationService.warn('Invalid Date', 'Transportation date cannot be earlier than arranged date.');
          row.get('transportDate')?.patchValue(bookedDate, { emitEvent: false });
        } else if (td.getTime() === bd.getTime()) {
          const bt = row.get('bookingTime')?.value;
          const tt = row.get('transportTime')?.value;
          if (bt && tt) {
            const bTime = new Date(bt).getHours() * 60 + new Date(bt).getMinutes();
            const tTime = new Date(tt).getHours() * 60 + new Date(tt).getMinutes();
            if (tTime < bTime) {
              this.notificationService.warn('Invalid Time', 'Transportation time cannot be earlier than booking time on the same day.');
              row.get('transportTime')?.patchValue(bt, { emitEvent: false });
            }
          }
        }
      }
    });

    this.updateDelayHours(index);
  }

  confirmSubmit(index: number): void {
    const row = this.formArray.at(index);
    if (row.invalid || !this.isPrecedingSubmitted(index)) return;

    this.confirmationService.confirm({
      message: `Submit Port & Customs Clearance for Shipment #${index + 1}?`,
      header: 'Submit Clearance Tracker',
      accept: () => {
        const formValue = row.getRawValue();
        const containerId = formValue['containerId'];
        if (!containerId) return;

        const toDate = (val: unknown) => (val ? new Date(val as Date).toISOString().split('T')[0] : '');

        this.updateDerivedDates(index);
        this.updateDelayHours(index);

        const transportationBooked = (formValue['transportationBooked'] || []).map((tb: any) => ({
          containerSerialNo: tb.containerSerialNo || '',
          transportCompanyName: tb.transportCompanyName || '',
          bookedDate: toDate(tb.bookedDate),
          bookingTime: this.toTimeString(tb.bookingTime),
          transportDate: toDate(tb.transportDate),
          transportTime: this.toTimeString(tb.transportTime),
          delayHours: tb.delayHours ?? null,
        }));

        const payload = new FormData();
        payload.append('arrivalOn', toDate(formValue['arrivalOn']));
        payload.append('shipmentFreeRetentionDate', toDate(formValue['shipmentFreeRetentionDate']));
        payload.append('portRetentionWithPenaltyDate', toDate(formValue['portRetentionWithPenaltyDate']));
        payload.append('maximumRetentionDate', toDate(formValue['maximumRetentionDate']));
        payload.append('arrivalNoticeDate', toDate(formValue['arrivalNoticeDate']));
        payload.append('arrivalNoticeFreeRetentionDays', String(formValue['arrivalNoticeFreeRetentionDays'] ?? ''));
        payload.append('advanceRequestDate', toDate(formValue['advanceRequestDate']));
        payload.append('doReleasedDate', toDate(formValue['doReleasedDate']));
        payload.append('doReleasedRemarks', formValue['doReleasedRemarks'] || '');
        payload.append('dpApprovalDate', toDate(formValue['dpApprovalDate']));
        payload.append('dpApprovalRemarks', formValue['dpApprovalRemarks'] || '');
        payload.append('customsClearanceDate', toDate(formValue['customsClearanceDate']));
        payload.append('customsClearanceRemarks', formValue['customsClearanceRemarks'] || '');
        payload.append('tokenReceivedDate', toDate(formValue['tokenReceivedDate']));
        payload.append('municipalityDate', toDate(formValue['municipalityDate']));
        payload.append('municipalityRemarks', formValue['municipalityRemarks'] || '');
        payload.append('transportationBooked', JSON.stringify(transportationBooked));

        const fileMap: Array<[Step5DocKind, string]> = [
          ['arrivalNotice', 'arrivalNoticeDocument'],
          ['advanceRequest', 'advanceRequestDocument'],
          ['doReleased', 'doReleasedDocument'],
          ['dpApproval', 'dpApprovalDocument'],
          ['customsClearance', 'customsClearanceDocument'],
          ['municipality', 'municipalityDocument'],
        ];
        fileMap.forEach(([kind, key]) => {
          const file = this.getFile(index, kind);
          if (file) payload.append(key, file, file.name);
        });

        this.store.dispatch(
          ShipmentActions.submitLogistics({
            containerId,
            index,
            payload,
          })
        );
      },
    });
  }

  isSectionSaving(index: number, section: 'arrivalNotice' | 'advanceRequest' | 'doReleased' | 'dpApproval' | 'customsClearance' | 'municipality' | 'transportation'): boolean {
    return this.sectionSavingKey() === `${section}-${index}`;
  }

  private sectionKey(index: number, section: 'arrivalNotice' | 'advanceRequest' | 'doReleased' | 'dpApproval' | 'customsClearance' | 'municipality' | 'transportation'): string {
    return `${index}:${section}`;
  }

  isLogisticsSectionLocked(index: number, section: 'arrivalNotice' | 'advanceRequest' | 'doReleased' | 'dpApproval' | 'customsClearance' | 'municipality' | 'transportation'): boolean {
    // If the user has explicit view+edit permission for this section, the row-level
    // submitted lock does not apply — only the section's own save-lock matters.
    const rowLocked = this.hasSectionPermission(section)
      ? false
      : this.isRowEditLocked(index);
    return rowLocked || !this.canEditLogisticsSection(section) || !!this.lockedSections()[this.sectionKey(index, section)];
  }

  isPortCustomsLocked(index: number): boolean {
    return this.isLogisticsSectionLocked(index, 'arrivalNotice');
  }

  isTransportationLocked(index: number): boolean {
    return this.isLogisticsSectionLocked(index, 'transportation');
  }

  unlockLogisticsSection(
    index: number,
    section: 'arrivalNotice' | 'advanceRequest' | 'doReleased' | 'dpApproval' | 'customsClearance' | 'municipality' | 'transportation'
  ): void {
    const rowLocked = this.hasSectionPermission(section) ? false : this.isRowEditLocked(index);
    if (rowLocked || !this.canEditLogisticsSection(section)) return;
    this.lockedSections.update((current) => ({
      ...current,
      [this.sectionKey(index, section)]: false,
    }));
    this.applySectionLocks(index);
  }

  async saveLogisticsSection(index: number, section: 'arrivalNotice' | 'advanceRequest' | 'doReleased' | 'dpApproval' | 'customsClearance' | 'municipality' | 'transportation'): Promise<void> {
    const group = this.formArray.at(index);
    const containerId = group?.get('containerId')?.value;
    const shipmentId = this.shipmentData()?.shipment?._id;
    if (!group || !containerId || !shipmentId || !this.canEditLogisticsSection(section) || this.isLogisticsSectionLocked(index, section)) return;
    this.ensureAccordionOpen(index);

    const sectionLabel = section === 'transportation'
      ? 'Transportation Arranged'
      : this.step5DocConfig.find((doc) => doc.kind === section)?.label || section;

    const confirmed = await this.confirmDialog.ask({
      message: `Save ${sectionLabel} for Shipment ${index + 1}?`,
      header: 'Save Section',
      acceptLabel: 'Yes, Save',
    });
    if (!confirmed) return;

    const toDate = (val: unknown) => (val ? new Date(val as Date).toISOString().split('T')[0] : '');
    const payload = new FormData();
    payload.append('sectionKey', section);

    if (section === 'transportation') {
      const transportationRows = this.getTransportationRows(group);
      transportationRows.markAllAsTouched();
      if (transportationRows.invalid) {
        this.messageService.add({
          severity: 'warn',
          summary: 'Invalid transportation timing',
          detail: 'Transportation date and time must be the same as or later than the arranged date and booking time.',
        });
        return;
      }
      this.updateDelayHours(index);
      const transportationBooked = this.getTransportationRows(group).getRawValue().map((tb: any) => ({
        containerSerialNo: tb.containerSerialNo || '',
        transportCompanyName: tb.transportCompanyName || '',
        bookedDate: toDate(tb.bookedDate),
        bookingTime: this.toTimeString(tb.bookingTime),
        transportDate: toDate(tb.transportDate),
        transportTime: this.toTimeString(tb.transportTime),
        delayHours: tb.delayHours ?? null,
      }));
      payload.append('transportationBooked', JSON.stringify(transportationBooked));
    } else if (section === 'arrivalNotice') {
      this.updateDerivedDates(index);
      payload.append('arrivalOn', toDate(group.get('arrivalOn')?.value));
      payload.append('shipmentFreeRetentionDate', toDate(group.get('shipmentFreeRetentionDate')?.value));
      payload.append('portRetentionWithPenaltyDate', toDate(group.get('portRetentionWithPenaltyDate')?.value));
      payload.append('maximumRetentionDate', toDate(group.get('maximumRetentionDate')?.value));
      payload.append('arrivalNoticeDate', toDate(group.get('arrivalNoticeDate')?.value));
      payload.append('arrivalNoticeFreeRetentionDays', String(group.get('arrivalNoticeFreeRetentionDays')?.value ?? ''));
      const file = this.getFile(index, 'arrivalNotice');
      if (file) payload.append('arrivalNoticeDocument', file, file.name);
    } else {
      const sectionMap = {
        advanceRequest: { date: 'advanceRequestDate', remarks: null, file: 'advanceRequestDocument' },
        doReleased: { date: 'doReleasedDate', remarks: 'doReleasedRemarks', file: 'doReleasedDocument' },
        dpApproval: { date: 'dpApprovalDate', remarks: 'dpApprovalRemarks', file: 'dpApprovalDocument' },
        customsClearance: { date: 'customsClearanceDate', remarks: 'customsClearanceRemarks', file: 'customsClearanceDocument' },
        municipality: { date: 'municipalityDate', remarks: 'municipalityRemarks', file: 'municipalityDocument' },
      } as const;
      const config = sectionMap[section];
      payload.append(config.date, toDate(group.get(config.date)?.value));
      if (config.remarks) payload.append(config.remarks, group.get(config.remarks)?.value || '');
      if (section === 'customsClearance') {
        payload.append('tokenReceivedDate', toDate(group.get('tokenReceivedDate')?.value));
      }
      const file = this.getFile(index, section);
      if (file) payload.append(config.file, file, file.name);
    }

    console.log(`📡 [ShipmentArrival] Saving section "${section}" for container ${containerId}`);
    payload.forEach((value, key) => {
      console.log(`   🔸 ${key}:`, value instanceof File ? `File(${value.name}, ${value.size} bytes)` : value);
    });

    this.sectionSavingKey.set(`${section}-${index}`);
    this.shipmentService.submitLogistics(containerId, payload).subscribe({
      next: () => {
        this.sectionSavingKey.set(null);
        this.lockedSections.update((current) => ({ ...current, [this.sectionKey(index, section)]: true }));
        this.applySectionLocks(index);
        this.store.dispatch(ShipmentActions.loadShipmentDetail({ id: shipmentId }));
        this.messageService.add({
          severity: 'success',
          summary: 'Saved',
          detail: `${section === 'transportation' ? 'Transportation arranged' : this.step5DocConfig.find((doc) => doc.kind === section)?.label || 'Section'} saved successfully.`,
        });
      },
      error: (error) => {
        this.sectionSavingKey.set(null);
        this.messageService.add({
          severity: 'error',
          summary: 'Save failed',
          detail: error.error?.message || 'Could not save this section.',
        });
      }
    });
  }

  savePortCustomsSection(index: number): void {
    this.saveLogisticsSection(index, 'arrivalNotice');
  }

  saveTransportationSection(index: number): void {
    this.saveLogisticsSection(index, 'transportation');
  }

  private updateDerivedDates(index: number): void {
    const group = this.formArray.at(index);
    const arrivalOn = group?.get('arrivalOn')?.value;
    if (!group || !arrivalOn) {
      group?.get('shipmentFreeRetentionDate')?.patchValue(null, { emitEvent: false });
      group?.get('portRetentionWithPenaltyDate')?.patchValue(null, { emitEvent: false });
      group?.get('maximumRetentionDate')?.patchValue(null, { emitEvent: false });
      return;
    }

    const actualData = this.shipmentData()?.actual?.[index];
    const freeDays =
      Number(group.get('arrivalNoticeFreeRetentionDays')?.value ?? 0) ||
      Number(actualData?.freeDetentionDays ?? 0) ||
      0;
    const maxDays = Number(actualData?.maximumDetentionDays ?? 0) || 0;

    // POINT 12: Port Free Retention Date = arrival + free days (from document)
    const freeRetentionDate = this.addDays(arrivalOn, freeDays);
    group.get('shipmentFreeRetentionDate')?.patchValue(freeRetentionDate, { emitEvent: false });

    // POINT 12: Port Free Retention Date (maximumRetentionDate field) = arrival + 10 days (always fixed)
    const portFreeRetentionDate = this.addDays(arrivalOn, 10);
    group.get('maximumRetentionDate')?.patchValue(portFreeRetentionDate, { emitEvent: false });

    // POINT 12: Port Demurrage Start Date = arrival + 10 days + 1 day = day 11
    const portDemurrageStartDate = this.addDays(arrivalOn, 11);
    group.get('portRetentionWithPenaltyDate')?.patchValue(portDemurrageStartDate, { emitEvent: false });
  }

  private updateDelayHours(index: number): void {
    const group = this.formArray.at(index);
    const storageGroup = (this.shipmentData()?.actual?.[index] as any)?.storageSplits || [];
    this.getTransportationRows(group).controls.forEach((row) => {
      const serial = row.get('containerSerialNo')?.value;
      const storageMatch = storageGroup.find((item: any) => item.containerSerialNo === serial);
      const delayHours = this.calculateDelayHours(
        row.get('transportDate')?.value,
        row.get('transportTime')?.value,
        storageMatch?.receivedOnDate,
        storageMatch?.receivedOnTime
      );
      row.get('delayHours')?.patchValue(delayHours, { emitEvent: false });
      });
  }

  private extractArrivalNotice(index: number, file: File): void {
    const formData = new FormData();
    formData.append('file', file, file.name);
    this.extractingArrivalNoticeRowIndex.set(index);
    this.startExtractionExperience();
    this.shipmentService.extractArrivalNoticeFromDocument(formData).subscribe({
      next: (res) => {
        this.extractingArrivalNoticeRowIndex.set(null);
        this.stopExtractionExperience();
        const group = this.formArray.at(index);
        if (!group) return;

        // POINT 12: Arrival Notice Date = print_date on the document (not arrival_on)
        // print_date is the date the document was printed/issued
        const printDate = res.print_date || res.printed_date || res.issue_date;
        if (printDate) {
          const parsedPrintDate = this.parseApiDate(printDate);
          group.get('arrivalNoticeDate')?.setValue(parsedPrintDate);
        }

        // arrivalOn = actual vessel arrival date (separate from print date)
        if (res.arrival_on) {
          const parsedArrivalOn = this.parseApiDate(res.arrival_on);
          group.get('arrivalOn')?.setValue(parsedArrivalOn);
        }

        if (res.free_retension_days != null) {
          group.get('arrivalNoticeFreeRetentionDays')?.setValue(Number(res.free_retension_days) || 0);
        }
        this.updateDerivedDates(index);
        group.updateValueAndValidity({ emitEvent: false });
        this.messageService.add({
          severity: 'success',
          summary: 'Arrival notice extracted',
          detail: 'Arrival date and free retention days were populated from the uploaded document.'
        });
      },
      error: (err) => {
        this.extractingArrivalNoticeRowIndex.set(null);
        this.stopExtractionExperience();
        this.messageService.add({
          severity: 'warn',
          summary: 'Arrival notice extraction failed',
          detail: err.error?.message || 'We could not extract arrival details from the uploaded document.'
        });
      }
    });
  }

  private parseApiDate(value: string): Date | null {
    if (!value) return null;
    const parts = value.split('-').map((part) => Number(part));
    if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
      const [year, month, day] = parts;
      return new Date(year, month - 1, day);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private toTimeString(value: unknown): string {
    if (!value) return '';
    if (value instanceof Date) {
      const hours = String(value.getHours()).padStart(2, '0');
      const minutes = String(value.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    }
    if (typeof value === 'string') return value;
    return '';
  }

  private combineDateTime(dateValue: unknown, timeValue: unknown): Date | null {
    if (!dateValue || !timeValue) return null;
    const date = new Date(dateValue as string | Date);
    if (Number.isNaN(date.getTime())) return null;
    const timeString = this.toTimeString(timeValue);
    const [hours, minutes] = timeString.split(':').map((part) => Number(part));
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  private calculateDelayHours(
    transportDateValue: unknown,
    transportTimeValue: unknown,
    receivedDateValue: unknown,
    receivedTimeValue: unknown,
  ): number {
    const transportAt = this.combineDateTime(transportDateValue, transportTimeValue);
    const receivedAt = this.combineDateTime(receivedDateValue, receivedTimeValue);
    if (!transportAt || !receivedAt) return 0;
    return Math.max(0, Math.round(((receivedAt.getTime() - transportAt.getTime()) / 3600000) * 100) / 100);
  }

  private addDays(dateValue: unknown, days: number): Date | null {
    if (!dateValue) return null;
    const date = new Date(dateValue as string | Date);
    if (Number.isNaN(date.getTime())) return null;
    date.setDate(date.getDate() + days);
    return date;
  }

  private syncAllSectionLocks(): void {
    const data = this.shipmentData();
    if (!data?.actual || !this.formArray) return;

    this.lockedSections.update((current) => {
      const next = { ...current };
      data.actual.forEach((actualRow: any, index: number) => {
        const locked = actualRow['lockedLogisticsSections'] || [];
        const sections: (Step5DocKind | 'transportation')[] = [
          'arrivalNotice', 'advanceRequest', 'doReleased', 
          'dpApproval', 'customsClearance', 'municipality', 'transportation'
        ];
        sections.forEach((s) => {
          const key = this.sectionKey(index, s);
          next[key] = next[key] ?? locked.includes(s);
        });
      });
      return next;
    });
  }

  private applySectionLocks(index: number): void {
    const group = this.formArray.at(index);
    if (!group) return;

    const sectionControls: Record<string, string[]> = {
      arrivalNotice: ['arrivalNoticeDate', 'arrivalOn', 'shipmentFreeRetentionDate', 'maximumRetentionDate', 'portRetentionWithPenaltyDate', 'arrivalNoticeFreeRetentionDays'],
      advanceRequest: ['advanceRequestDate'],
      doReleased: ['doReleasedDate', 'doReleasedRemarks'],
      dpApproval: ['dpApprovalDate', 'dpApprovalRemarks'],
      customsClearance: ['customsClearanceDate', 'customsClearanceRemarks', 'tokenReceivedDate'],
      municipality: ['municipalityDate', 'municipalityRemarks'],
    };

    Object.entries(sectionControls).forEach(([section, controls]) => {
      controls.forEach((controlName) => {
        const control = group.get(controlName);
        if (!control) return;
        const sectionRowLocked = this.hasSectionPermission(section as LogisticsSectionKey)
          ? false
          : this.isRowEditLocked(index);
        if (!this.canEditLogisticsSection(section as LogisticsSectionKey) || this.isLogisticsSectionLocked(index, section as any)) {
          control.disable({ emitEvent: false });
        } else if (!sectionRowLocked) {
          control.enable({ emitEvent: false });
        }
      });
    });

    const transportation = group.get('transportationBooked') as FormArray | null;
    const transportRowLocked = this.hasSectionPermission('transportation')
      ? false
      : this.isRowEditLocked(index);
    transportation?.controls.forEach((row) => {
      if (!this.canEditLogisticsSection('transportation') || this.isLogisticsSectionLocked(index, 'transportation')) {
        row.disable({ emitEvent: false });
      } else if (!transportRowLocked) {
        row.enable({ emitEvent: false });
        row.get('delayHours')?.disable({ emitEvent: false });
      }
    });
  }
}
