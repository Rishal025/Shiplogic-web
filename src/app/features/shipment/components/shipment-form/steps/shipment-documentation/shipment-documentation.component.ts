import { Component, Input, Output, EventEmitter, inject, effect, signal, computed, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormArray, AbstractControl, FormGroup } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { ConfirmationService } from 'primeng/api';
import { NotificationService } from '../../../../../../core/services/notification.service';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import { AccordionModule } from 'primeng/accordion';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import {
  selectShipmentData,
  selectSubmittedActualIndices,
  selectSubmittedStep3Indices,
  selectSubmittingRowIndex,
} from '../../../../../../store/shipment/shipment.selectors';
import * as ShipmentActions from '../../../../../../store/shipment/shipment.actions';

@Component({
  selector: 'app-shipment-documentation',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputTextModule,
    InputNumberModule,
    DatePickerModule,
    SelectModule,
    AccordionModule,
    ConfirmDialogModule,
    DialogModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './shipment-documentation.component.html',
  styles: [`
    .primary-milestone-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      border-radius: 0.75rem;
      background-color: #3b82f6;
      padding: 0.625rem 1.25rem;
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #ffffff;
      transition: all 0.2s ease-in-out;
      box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.2);
      cursor: pointer;
    }
    .primary-milestone-btn:hover:not(:disabled) {
      background-color: #2563eb;
      transform: translateY(-1px);
      box-shadow: 0 10px 15px -3px rgba(59, 130, 246, 0.25);
    }
    .primary-milestone-btn:active:not(:disabled) { transform: scale(0.98); }
    .primary-milestone-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .icon-btn-secondary {
      display: inline-flex;
      height: 2.5rem;
      width: 2.5rem;
      align-items: center;
      justify-content: center;
      border-radius: 0.5rem;
      border: 1px solid #e2e8f0;
      background-color: #ffffff;
      color: #64748b;
      transition: all 0.2s;
      cursor: pointer;
    }
    .icon-btn-secondary:hover { background-color: #f1f5f9; color: #3b82f6; border-color: #3b82f6; }

    .icon-btn-danger {
      display: inline-flex;
      height: 2.5rem;
      width: 2.5rem;
      align-items: center;
      justify-content: center;
      border-radius: 0.5rem;
      border: 1px solid #fee2e2;
      background-color: #fef2f2;
      color: #ef4444;
      transition: all 0.2s;
      cursor: pointer;
    }
    .icon-btn-danger:hover { background-color: #fee2e2; color: #dc2626; }
  `]
})
export class ShipmentDocumentationComponent {
  @Input({ required: true }) formArray!: FormArray;
  @Output() navigateToSplit = new EventEmitter<void>();

  @ViewChild('inwardAdviceFileInput') inwardAdviceFileInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('murabahaSubmittedFileInput') murabahaSubmittedFileInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('documentsReleasedFileInput') documentsReleasedFileInputRef?: ElementRef<HTMLInputElement>;

  /** Set right before programmatic .click() so (change) knows which row. */
  private pendingFileRow: number | null = null;
  private pendingFileKind: 'inwardAdvice' | 'murabahaSubmitted' | 'documentsReleased' | null = null;

  private store = inject(Store);
  private confirmationService = inject(ConfirmationService);
  private notificationService = inject(NotificationService);
  private sanitizer = inject(DomSanitizer);

  readonly shipmentData = toSignal(this.store.select(selectShipmentData));

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

  readonly inwardAdviceFile = signal<Record<number, File | null>>({});
  readonly murabahaSubmittedFile = signal<Record<number, File | null>>({});
  readonly documentsReleasedFile = signal<Record<number, File | null>>({});
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
  
  // Dropdown Options
  readonly receiverOptions = [
    { label: 'Direct', value: 'Direct' },
    { label: 'Bank', value: 'Bank' }
  ];

  readonly bankOptions = [
    { label: 'ADIB', value: 'ADIB' },
    { label: 'RAK BANK', value: 'RAK BANK' },
    { label: 'ENBD', value: 'ENBD' },
    { label: 'FAB', value: 'FAB' },
    { label: 'HSBC', value: 'HSBC' },
    { label: 'MASHREQ', value: 'MASHREQ' },
    { label: 'OTHERS', value: 'OTHERS' }
  ];

  // Per-row and per-milestone edit states
  readonly editingMilestones = signal<Record<number, Record<string, boolean>>>({});
  readonly savingMilestone = signal<{row: number, milestone: string} | null>(null);

  /** Checks if a specific milestone has data saved from the server (Source of Truth). */
  isMilestoneSaved(index: number, milestone: string): boolean {
    const shipment = this.shipmentData()?.actual?.[index];
    if (!shipment) return false;

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

  isMilestoneEditing(index: number, milestone: string): boolean {
    const rowEditing = this.editingMilestones()[index];
    if (rowEditing?.[milestone]) return true;
    return !this.isMilestoneSaved(index, milestone);
  }

  toggleEditMilestone(index: number, milestone: string, editing: boolean = true): void {
    this.editingMilestones.update(current => {
      const row = current[index] || {};
      return {
        ...current,
        [index]: { ...row, [milestone]: editing }
      };
    });
  }

  onFilesSelected(event: Event, containerIndex: number, kind: 'inwardAdvice' | 'murabahaSubmitted' | 'documentsReleased'): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;

    const targetSignal =
      kind === 'inwardAdvice'
        ? this.inwardAdviceFile
        : kind === 'murabahaSubmitted'
          ? this.murabahaSubmittedFile
          : this.documentsReleasedFile;

    targetSignal.update((current) => ({
      ...current,
      [containerIndex]: file,
    }));

    input.value = '';
  }

  clickFileInput(index: number, kind: 'inwardAdvice' | 'murabahaSubmitted' | 'documentsReleased'): void {
    this.pendingFileRow = index;
    this.pendingFileKind = kind;
    const refs = {
      inwardAdvice: this.inwardAdviceFileInputRef,
      murabahaSubmitted: this.murabahaSubmittedFileInputRef,
      documentsReleased: this.documentsReleasedFileInputRef,
    };
    const el = refs[kind]?.nativeElement;
    if (el) el.click();
  }

  onFileInputChange(event: Event, kind: 'inwardAdvice' | 'murabahaSubmitted' | 'documentsReleased'): void {
    const row = this.pendingFileRow;
    if (row !== null && this.pendingFileKind === kind) this.onFilesSelected(event, row, kind);
    this.pendingFileRow = null;
    this.pendingFileKind = null;
  }

  getFile(containerIndex: number, kind: 'inwardAdvice' | 'murabahaSubmitted' | 'documentsReleased'): File | null {
    const source =
      kind === 'inwardAdvice'
        ? this.inwardAdviceFile()
        : kind === 'murabahaSubmitted'
          ? this.murabahaSubmittedFile()
          : this.documentsReleasedFile();
    return source[containerIndex] ?? null;
  }

  clearFile(containerIndex: number, kind: 'inwardAdvice' | 'murabahaSubmitted' | 'documentsReleased'): void {
    const targetSignal =
      kind === 'inwardAdvice'
        ? this.inwardAdviceFile
        : kind === 'murabahaSubmitted'
          ? this.murabahaSubmittedFile
          : this.documentsReleasedFile;

    targetSignal.update((current) => ({
      ...current,
      [containerIndex]: null,
    }));
  }

  getSavedFileUrl(group: AbstractControl, kind: 'inwardAdvice' | 'murabahaSubmitted' | 'documentsReleased'): string {
    const controlName =
      kind === 'inwardAdvice'
        ? 'inwardCollectionAdviceDocumentUrl'
        : kind === 'murabahaSubmitted'
          ? 'murabahaContractSubmittedDocumentUrl'
          : 'documentsReleasedDocumentUrl';
    return group.get(controlName)?.value || '';
  }

  getSavedFileName(group: AbstractControl, kind: 'inwardAdvice' | 'murabahaSubmitted' | 'documentsReleased'): string {
    const controlName =
      kind === 'inwardAdvice'
        ? 'inwardCollectionAdviceDocumentName'
        : kind === 'murabahaSubmitted'
          ? 'murabahaContractSubmittedDocumentName'
          : 'documentsReleasedDocumentName';
    return group.get(controlName)?.value || '';
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

  getShipmentNoLabel(index: number): string {
    if (this.formArray?.controls[index] == null) return '–';
    const base = this.shipmentData()?.shipment?.shipmentNo?.replace(/\([^)]*\)/g, '').trim();
    const num = base?.trim() ? `${base}-${index + 1}` : '–';
    return num;
  }

  readonly submittedIndices = toSignal(this.store.select(selectSubmittedStep3Indices), { initialValue: [] });
  readonly precedingIndices = toSignal(this.store.select(selectSubmittedActualIndices), { initialValue: [] });
  readonly submittingRowIndex = toSignal(this.store.select(selectSubmittingRowIndex), { initialValue: null });

  constructor() {
    effect(() => {
      const data = this.shipmentData();
      if (!data || !this.formArray) return;
      this.formArray.controls.forEach((group) => {
        if (!group.get('bankName')?.value && data.shipment?.bankName) {
          group.get('bankName')?.patchValue(data.shipment.bankName, { emitEvent: false });
          if (!group.get('receiver')?.value) group.get('receiver')?.patchValue('Bank', { emitEvent: false });
        }
      });
    });

    effect(() => {
      const submittingIndex = this.submittingRowIndex();
      const currentSaving = this.savingMilestone();
      if (currentSaving && submittingIndex === null) {
        this.toggleEditMilestone(currentSaving.row, currentSaving.milestone, false);
        this.savingMilestone.set(null);
      }
    });

  }

  isPrecedingSubmitted(index: number): boolean {
    return this.precedingIndices().includes(index);
  }

  isRowSubmitted(index: number): boolean {
    return this.submittedIndices().includes(index);
  }

  isBankReceiver(group: FormGroup): boolean {
    return group.get('receiver')?.value === 'Bank';
  }

  getBlDocumentUrl(index: number): string {
    return this.shipmentData()?.actual?.[index]?.blDocumentUrl || '';
  }

  getBlDocumentName(index: number): string {
    return this.shipmentData()?.actual?.[index]?.blDocumentName || 'B/L Document';
  }

  isMilestoneSaving(index: number, milestone: string): boolean {
    const s = this.savingMilestone();
    return s?.row === index && s?.milestone === milestone;
  }

  /** Header shortcut: Saves the currently active/editing milestone. */
  saveActivePhase(index: number): void {
    const milestones = ['courier', 'receiving', 'inward', 'murabaha_process', 'murabaha_submit', 'release'];
    const activeMilestone = milestones.find(m => this.isMilestoneEditing(index, m));
    if (activeMilestone) {
      this.saveMilestone(index, activeMilestone);
    } else {
      this.notificationService.info('Information', 'No active phase to save.');
    }
  }

  isMilestoneSectionValid(index: number, milestone: string): boolean {
    const group = this.formArray.at(index) as FormGroup;
    if (!group) return false;

    // Check baseline requirement: BL Number
    if (!group.get('BLNo')?.value) {
      this.notificationService.error('Validation Error', 'B/L Number is required for any save action.');
      return false;
    }

    switch (milestone) {
      case 'courier':
        // Optional notes and track no, but usually one should exist. Let's allow empty for now if BL is there.
        return true;
      case 'receiving':
        if (!group.get('receiver')?.value) {
          this.notificationService.error('Validation Error', 'Receiver type is required.');
          return false;
        }
        if (group.get('receiver')?.value === 'Bank' && !group.get('bankName')?.value) {
          this.notificationService.error('Validation Error', 'Bank Name is required when receiver is Bank.');
          return false;
        }
        return true;
      case 'inward':
        return true;
      case 'murabaha_process':
        return true;
      case 'murabaha_submit':
        return true;
      case 'release':
        return true;
      default:
        return true;
    }
  }

  saveMilestone(index: number, milestone: string): void {
    const row = this.formArray.at(index);
    if (!this.isPrecedingSubmitted(index)) {
      this.notificationService.warn('Step Blocked', 'Please complete the BL Details step first.');
      return;
    }
    
    // Only check milestone-specific validity
    if (!this.isMilestoneSectionValid(index, milestone)) return;

    this.confirmationService.confirm({
      message: `Save ${milestone.replace('_', ' ')} details for Container #${index + 1}?`,
      header: 'Save Documentation Stage',
      accept: () => {
        const formValue = row.getRawValue();
        const containerId = formValue['containerId'];
        if (!containerId) return;

        this.savingMilestone.set({ row: index, milestone });

        const toDate = (val: any) =>
          val ? (val instanceof Date ? val.toISOString().split('T')[0] : new Date(val).toISOString().split('T')[0]) : '';

        const payload = new FormData();
        payload.append('BLNo', formValue['BLNo'] || '');

        switch (milestone) {
          case 'courier':
            payload.append('courierTrackNo', formValue['courierTrackNo'] || '');
            payload.append('courierServiceProvider', formValue['courierServiceProvider'] || '');
            payload.append('DHL', formValue['courierTrackNo'] || '');
            payload.append('docArrivalNotes', formValue['docArrivalNotes'] || '');
            break;
          case 'receiving':
            payload.append('receiver', formValue['receiver'] || '');
            payload.append('bankName', formValue['bankName'] || '');
            payload.append('expectedDocDate', toDate(formValue['expectedDocDate']));
            break;
          case 'inward':
            payload.append('inwardCollectionAdviceDate', toDate(formValue['inwardCollectionAdviceDate']));
            const inf = this.getFile(index, 'inwardAdvice');
            if (inf) payload.append('inwardCollectionAdviceDocument', inf, inf.name);
            break;
          case 'murabaha_process':
            payload.append('murabahaContractReleasedDate', toDate(formValue['murabahaContractReleasedDate']));
            payload.append('murabahaContractApprovedDate', toDate(formValue['murabahaContractApprovedDate']));
            break;
          case 'murabaha_submit':
            payload.append('murabahaContractSubmittedDate', toDate(formValue['murabahaContractSubmittedDate']));
            const msf = this.getFile(index, 'murabahaSubmitted');
            if (msf) payload.append('murabahaContractSubmittedDocument', msf, msf.name);
            break;
          case 'release':
            payload.append('documentsReleasedDate', toDate(formValue['documentsReleasedDate']));
            const drf = this.getFile(index, 'documentsReleased');
            if (drf) payload.append('documentsReleasedDocument', drf, drf.name);
            break;
        }

        this.store.dispatch(ShipmentActions.submitDocumentation({ containerId, index, payload }));
      },
    });
  }

  // Row-level save for legacy support
  confirmSubmit(index: number): void {
    if (!this.isMilestoneSectionValid(index, 'all')) return;
    this.confirmationService.confirm({
      message: `Save all documentation for Container #${index + 1}?`,
      header: 'Save Documentation',
      accept: () => {
        const row = this.formArray.at(index);
        const formValue = row.getRawValue();
        const payload = new FormData();
        const toDate = (v: any) => v ? (v instanceof Date ? v.toISOString().split('T')[0] : new Date(v).toISOString().split('T')[0]) : '';
        
        payload.append('BLNo', formValue['BLNo'] || '');
        payload.append('courierTrackNo', formValue['courierTrackNo'] || '');
        payload.append('courierServiceProvider', formValue['courierServiceProvider'] || '');
        payload.append('docArrivalNotes', formValue['docArrivalNotes'] || '');
        payload.append('expectedDocDate', toDate(formValue['expectedDocDate']));
        payload.append('receiver', formValue['receiver'] || '');
        payload.append('bankName', formValue['bankName'] || '');
        payload.append('inwardCollectionAdviceDate', toDate(formValue['inwardCollectionAdviceDate']));
        payload.append('murabahaContractReleasedDate', toDate(formValue['murabahaContractReleasedDate']));
        payload.append('murabahaContractApprovedDate', toDate(formValue['murabahaContractApprovedDate']));
        payload.append('murabahaContractSubmittedDate', toDate(formValue['murabahaContractSubmittedDate']));
        payload.append('documentsReleasedDate', toDate(formValue['documentsReleasedDate']));

        const fl1 = this.getFile(index, 'inwardAdvice');
        const fl2 = this.getFile(index, 'murabahaSubmitted');
        const fl3 = this.getFile(index, 'documentsReleased');
        if (fl1) payload.append('inwardCollectionAdviceDocument', fl1, fl1.name);
        if (fl2) payload.append('murabahaContractSubmittedDocument', fl2, fl2.name);
        if (fl3) payload.append('documentsReleasedDocument', fl3, fl3.name);

        this.store.dispatch(ShipmentActions.submitDocumentation({ containerId: formValue['containerId'], index, payload }));
      }
    });
  }

  openStatusModal(index: number): void {
    this.statusModalShipmentIndex.set(index);
    this.statusModalVisible.set(true);
  }

  onStatusModalVisibleChange(v: boolean): void {
    this.statusModalVisible.set(v);
    if (!v) this.statusModalShipmentIndex.set(null);
  }

  getShipmentReachedStage(index: number): string {
    const shipment = this.shipmentData()?.actual?.[index];
    if (shipment?.paymentCostingDocumentUrl || shipment?.paymentAllocations?.length || shipment?.paymentCostings?.length) return 'Payment & Costing';
    if (shipment?.qualityRows?.length || shipment?.qualityReports?.length) return 'Quality';
    if (shipment?.storageSplits?.length) return 'Storage Allocation & Arrival';
    if (shipment?.arrivalOn || shipment?.arrivalNoticeDate || shipment?.arrivalNoticeDocumentUrl) return 'Port and Customs Clearance Tracker';
    if (this.submittedIndices().includes(index)) return 'Document Tracker';
    return 'Shipment Tracker';
  }

  isStageCompletedForShipment(index: number, stageIndex: number): boolean {
    if (stageIndex <= 1) return true;
    if (stageIndex === 2) return this.precedingIndices().includes(index);
    if (stageIndex === 3) return this.submittedIndices().includes(index);
    const reached = this.getShipmentReachedStage(index);
    return stageIndex < this.shipmentStages.indexOf(reached as any);
  }

  isCurrentStageForShipment(index: number, stageIndex: number): boolean {
    return this.shipmentStages[stageIndex] === this.getShipmentReachedStage(index);
  }
}
