import { Component, Input, computed, inject, signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, AbstractControl } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { AccordionModule } from 'primeng/accordion';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { selectShipmentData } from '../../../../../../store/shipment/shipment.selectors';

type QualityDocKind = 'inhouse' | 'strategic' | 'thirdParty' | 'report';

@Component({
  selector: 'app-shipment-quality',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    AccordionModule,
    DatePickerModule,
    DialogModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
  ],
  templateUrl: './shipment-quality.component.html',
  styleUrls: ['./shipment-quality.component.scss'],
})
export class ShipmentQualityComponent {
  @Input({ required: true }) formArray!: FormArray;

  @ViewChild('qualityDocInput') qualityDocInputRef?: ElementRef<HTMLInputElement>;

  private fb = inject(FormBuilder);
  private sanitizer = inject(DomSanitizer);
  private store = inject(Store);

  readonly shipmentData = toSignal(this.store.select(selectShipmentData));
  readonly phaseOptions = [
    { label: 'S1', value: 'S1' },
    { label: 'S2', value: 'S2' },
    { label: 'S3', value: 'S3' },
  ];

  private pendingUpload:
    | { shipmentIndex: number; rowIndex: number; kind: QualityDocKind; table: 'qualityRows' | 'qualityReports' }
    | null = null;

  readonly uploadedFiles = signal<Record<string, File | null>>({});

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

  getQualityRows(group: AbstractControl): FormArray {
    return (group as FormGroup).get('qualityRows') as FormArray;
  }

  getQualityReports(group: AbstractControl): FormArray {
    return (group as FormGroup).get('qualityReports') as FormArray;
  }

  addQualityRow(group: AbstractControl): void {
    const rows = this.getQualityRows(group);
    rows.push(
      this.fb.group({
        sn: [rows.length + 1],
        sampleNo: [''],
        phase: ['S1'],
        date: [null],
        inhouseReportNo: [''],
        inhouseReportDate: [null],
        strategicReportNo: [''],
        strategicReportDate: [null],
        thirdPartyReportNo: [''],
        thirdPartyReportDate: [null],
      })
    );
  }

  removeQualityRow(group: AbstractControl, rowIndex: number): void {
    const rows = this.getQualityRows(group);
    if (rows.length <= 1) return;
    rows.removeAt(rowIndex);
    rows.controls.forEach((ctrl, idx) => {
      (ctrl as FormGroup).get('sn')?.setValue(idx + 1, { emitEvent: false });
    });
  }

  addQualityReportRow(group: AbstractControl): void {
    const rows = this.getQualityReports(group);
    rows.push(
      this.fb.group({
        phase: ['S1'],
        reportDate: [null],
      })
    );
  }

  removeQualityReportRow(group: AbstractControl, rowIndex: number): void {
    const rows = this.getQualityReports(group);
    if (rows.length <= 1) return;
    rows.removeAt(rowIndex);
  }

  private key(shipmentIndex: number, rowIndex: number, kind: QualityDocKind, table: 'qualityRows' | 'qualityReports'): string {
    return `${shipmentIndex}:${table}:${rowIndex}:${kind}`;
  }

  getFile(shipmentIndex: number, rowIndex: number, kind: QualityDocKind, table: 'qualityRows' | 'qualityReports'): File | null {
    return this.uploadedFiles()[this.key(shipmentIndex, rowIndex, kind, table)] ?? null;
  }

  clickFileInput(shipmentIndex: number, rowIndex: number, kind: QualityDocKind, table: 'qualityRows' | 'qualityReports'): void {
    this.pendingUpload = { shipmentIndex, rowIndex, kind, table };
    this.qualityDocInputRef?.nativeElement?.click();
  }

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (file && this.pendingUpload) {
      const { shipmentIndex, rowIndex, kind, table } = this.pendingUpload;
      const key = this.key(shipmentIndex, rowIndex, kind, table);
      this.uploadedFiles.update((cur) => ({ ...cur, [key]: file }));
    }
    this.pendingUpload = null;
    input.value = '';
  }

  clearFile(shipmentIndex: number, rowIndex: number, kind: QualityDocKind, table: 'qualityRows' | 'qualityReports'): void {
    const key = this.key(shipmentIndex, rowIndex, kind, table);
    this.uploadedFiles.update((cur) => ({ ...cur, [key]: null }));
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
}
