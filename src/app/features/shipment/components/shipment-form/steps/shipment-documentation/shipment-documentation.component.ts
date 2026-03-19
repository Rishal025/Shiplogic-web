import { Component, Input, Output, EventEmitter, inject, effect, signal, computed, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormArray, AbstractControl } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { ConfirmationService } from 'primeng/api';
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
  private sanitizer = inject(DomSanitizer);

  readonly shipmentData = toSignal(this.store.select(selectShipmentData));

  // Document preview modal (same as create shipment)
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

  onFilesSelected(
    event: Event,
    containerIndex: number,
    kind: 'inwardAdvice' | 'murabahaSubmitted' | 'documentsReleased'
  ): void {
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

  /** Called from button click - synchronously triggers the file input so the system dialog opens. */
  clickFileInput(index: number, kind: 'inwardAdvice' | 'murabahaSubmitted' | 'documentsReleased'): void {
    if (this.isRowSubmitted(index)) return;
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

  /** Accordion header: "Shipment No: {shipmentNo}-{index+1}" when shipment exists, else "Shipment No: -". */
  getShipmentNoLabel(index: number): string {
    if (this.formArray?.controls[index] == null) return '–';
    const base = this.shipmentData()?.shipment?.shipmentNo;
    const num = base?.trim() ? `${base}-${index + 1}` : '–';
    return num;
  }

  readonly receiverOptions = [
    { label: 'Bank', value: 'Bank' },
    { label: 'Direct', value: 'Direct' },
  ];
  readonly bankOptions = [
    { label: 'ADIB', value: 'ADIB' },
    { label: 'EIB', value: 'EIB' },
    { label: 'DIB', value: 'DIB' },
  ];

  readonly submittedIndices = toSignal(this.store.select(selectSubmittedStep3Indices), {
    initialValue: [],
  });
  readonly precedingIndices = toSignal(this.store.select(selectSubmittedActualIndices), {
    initialValue: [],
  });
  readonly submittingRowIndex = toSignal(this.store.select(selectSubmittingRowIndex), {
    initialValue: null,
  });

  constructor() {
    effect(() => {
      const indices = this.submittedIndices();
      indices.forEach((idx) => {
        if (this.formArray?.at(idx)) {
          this.formArray.at(idx).disable({ emitEvent: false });
        }
      });
    });
  }

  isRowSubmitted(index: number): boolean {
    return this.submittedIndices().includes(index);
  }

  isPrecedingSubmitted(index: number): boolean {
    return this.precedingIndices().includes(index);
  }

  isBankReceiver(group: AbstractControl): boolean {
    return group.get('receiver')?.value === 'Bank';
  }

  isBankSectionComplete(index: number, group: AbstractControl): boolean {
    if (!this.isBankReceiver(group)) return true;

    const requiredDateFields = [
      'bankName',
      'inwardCollectionAdviceDate',
      'murabahaContractReleasedDate',
      'murabahaContractApprovedDate',
      'murabahaContractSubmittedDate',
      'documentsReleasedDate',
    ];

    const hasMissingField = requiredDateFields.some((field) => !group.get(field)?.value);
    const hasMissingFile =
      !this.getFile(index, 'inwardAdvice') ||
      !this.getFile(index, 'murabahaSubmitted') ||
      !this.getFile(index, 'documentsReleased');

    return !hasMissingField && !hasMissingFile;
  }

  confirmSubmit(index: number) {
    const row = this.formArray.at(index);
    if (row.invalid || !this.isPrecedingSubmitted(index)) return;

    this.confirmationService.confirm({
      message: `Submit Documentation for Container #${index + 1}?`,
      header: 'Submit Documentation',
      accept: () => {
        const formValue = row.getRawValue();
        const containerId = formValue['containerId'];
        if (!containerId) return;

        const toDate = (val: any) =>
          val ? new Date(val).toISOString().split('T')[0] : '';

        this.store.dispatch(
          ShipmentActions.submitDocumentation({
            containerId,
            index,
            payload: {
              BLNo: formValue['BLNo'] || '',
              courierTrackNo: formValue['courierTrackNo'] || '',
              courierServiceProvider: formValue['courierServiceProvider'] || '',
              expectedDocDate: toDate(formValue['expectedDocDate']),
              receiver: formValue['receiver'] || '',
              bankName: formValue['bankName'] || '',
              inwardCollectionAdviceDate: toDate(formValue['inwardCollectionAdviceDate']),
              inwardCollectionAdviceDocumentUrl: '',
              murabahaContractReleasedDate: toDate(formValue['murabahaContractReleasedDate']),
              murabahaContractApprovedDate: toDate(formValue['murabahaContractApprovedDate']),
              murabahaContractSubmittedDate: toDate(formValue['murabahaContractSubmittedDate']),
              murabahaContractSubmittedDocumentUrl: '',
              documentsReleasedDate: toDate(formValue['documentsReleasedDate']),
              documentsReleasedDocumentUrl: '',
            },
          })
        );
      },
    });
  }
}
