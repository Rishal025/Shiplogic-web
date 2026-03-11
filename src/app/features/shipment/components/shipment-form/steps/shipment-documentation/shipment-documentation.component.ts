import { Component, Input, Output, EventEmitter, inject, effect, signal, computed, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormArray } from '@angular/forms';
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

  @ViewChild('baFileInput') baFileInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('approvedFileInput') approvedFileInputRef?: ElementRef<HTMLInputElement>;

  /** Set right before programmatic .click() so (change) knows which row. */
  private pendingFileRow: number | null = null;
  private pendingFileKind: 'bankAdvance' | 'approved' | null = null;

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

  // Local-only file selections for bank advance documents (to be wired to S3 later)
  readonly bankAdvanceFile = signal<Record<number, File | null>>({});
  readonly bankAdvanceApprovedFile = signal<Record<number, File | null>>({});

  onFilesSelected(
    event: Event,
    containerIndex: number,
    kind: 'bankAdvance' | 'approved'
  ): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;

    const targetSignal =
      kind === 'bankAdvance' ? this.bankAdvanceFile : this.bankAdvanceApprovedFile;

    targetSignal.update((current) => ({
      ...current,
      [containerIndex]: file,
    }));

    input.value = '';
  }

  /** Called from button click - synchronously triggers the file input so the system dialog opens. */
  clickFileInput(index: number, kind: 'bankAdvance' | 'approved'): void {
    if (this.isRowSubmitted(index)) return;
    this.pendingFileRow = index;
    this.pendingFileKind = kind;
    const el = kind === 'bankAdvance' ? this.baFileInputRef?.nativeElement : this.approvedFileInputRef?.nativeElement;
    if (el) el.click();
  }

  onFileInputChange(event: Event, kind: 'bankAdvance' | 'approved'): void {
    const row = this.pendingFileRow;
    if (row !== null && this.pendingFileKind === kind) this.onFilesSelected(event, row, kind);
    this.pendingFileRow = null;
    this.pendingFileKind = null;
  }

  getFile(containerIndex: number, kind: 'bankAdvance' | 'approved'): File | null {
    const source =
      kind === 'bankAdvance' ? this.bankAdvanceFile() : this.bankAdvanceApprovedFile();
    return source[containerIndex] ?? null;
  }

  clearFile(containerIndex: number, kind: 'bankAdvance' | 'approved'): void {
    const targetSignal =
      kind === 'bankAdvance' ? this.bankAdvanceFile : this.bankAdvanceApprovedFile;

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
              DHL: formValue['DHL'] || '',
              expectedDocDate: toDate(formValue['expectedDocDate']),
              receiver: formValue['receiver'] || '',
              bankAdvanceAmountDocumentUrl: '', // S3 integration later
              bankAdvanceApprovedDocumentUrl: '', // S3 integration later
              bankAdvanceSubmittedOn: toDate(formValue['bankAdvanceSubmittedOn']),
              docToBeReleasedOn: toDate(formValue['docToBeReleasedOn']),
            },
          })
        );
      },
    });
  }
}
