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

  readonly step5DocConfig = STEP5_DOC_CONFIG;
  readonly secondaryStep5DocConfig = STEP5_DOC_CONFIG.filter((doc) => doc.kind !== 'arrivalNotice');

  @ViewChild('arrivalNoticeInput') arrivalNoticeInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('advanceRequestInput') advanceRequestInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('doReleasedInput') doReleasedInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('dpApprovalInput') dpApprovalInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('customsClearanceInput') customsClearanceInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('municipalityInput') municipalityInputRef?: ElementRef<HTMLInputElement>;

  private pendingFileRow: number | null = null;
  private pendingDocKind: Step5DocKind | null = null;

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
  readonly lockedPortCustomsSections = signal<Record<number, boolean>>({});
  readonly lockedTransportationSections = signal<Record<number, boolean>>({});

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
        if (this.formArray.at(idx)) this.formArray.at(idx).disable({ emitEvent: false });
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

  isPrecedingSubmitted(index: number): boolean {
    return this.precedingIndices().includes(index);
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
    if (this.isRowSubmitted(index)) return;
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
    return this.isRowSubmitted(index) || !!this.lockedSections()[this.sectionKey(index, section)];
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
    if (this.isRowSubmitted(index)) return;
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
    if (!group || !containerId || !shipmentId || this.isLogisticsSectionLocked(index, section)) return;

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
    const freeRetentionDate = this.addDays(arrivalOn, freeDays);
    group.get('shipmentFreeRetentionDate')?.patchValue(freeRetentionDate, { emitEvent: false });
    const maximumRetentionDate = maxDays > 0 ? this.addDays(arrivalOn, maxDays) : null;
    group.get('maximumRetentionDate')?.patchValue(maximumRetentionDate, { emitEvent: false });
    group.get('portRetentionWithPenaltyDate')?.patchValue(freeRetentionDate, { emitEvent: false });
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
        if (res.arrival_on) {
          const parsedArrivalOn = this.parseApiDate(res.arrival_on);
          group.get('arrivalOn')?.setValue(parsedArrivalOn);
          if (!group.get('arrivalNoticeDate')?.value) {
            group.get('arrivalNoticeDate')?.setValue(parsedArrivalOn);
          }
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
        if (this.isLogisticsSectionLocked(index, section as any)) {
          control.disable({ emitEvent: false });
        } else if (!this.isRowSubmitted(index)) {
          control.enable({ emitEvent: false });
        }
      });
    });

    const transportation = group.get('transportationBooked') as FormArray | null;
    transportation?.controls.forEach((row) => {
      if (this.isLogisticsSectionLocked(index, 'transportation')) {
        row.disable({ emitEvent: false });
      } else if (!this.isRowSubmitted(index)) {
        row.enable({ emitEvent: false });
        row.get('delayHours')?.disable({ emitEvent: false });
      }
    });
  }
}
