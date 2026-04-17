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
import { TableModule } from 'primeng/table';
import { selectShipmentData } from '../../../../../../store/shipment/shipment.selectors';
import * as ShipmentActions from '../../../../../../store/shipment/shipment.actions';
import { ShipmentService } from '../../../../../../core/services/shipment.service';
import { NotificationService } from '../../../../../../core/services/notification.service';

type QualityDocKind = 'inhouse' | 'strategic' | 'thirdParty' | 'attachment' | 'report';

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
    TableModule,
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
  private shipmentService = inject(ShipmentService);
  private notificationService = inject(NotificationService);

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
  readonly savingRowIndex = signal<number | null>(null);

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
    const base = this.shipmentData()?.shipment?.shipmentNo?.replace(/\([^)]*\)/g, '').trim();
    return base?.trim() ? `${base}-${index + 1}` : '–';
  }

  getQualityRows(group: AbstractControl): FormArray {
    return (group as FormGroup).get('qualityRows') as FormArray;
  }

  getQualityReports(group: AbstractControl): FormArray {
    return (group as FormGroup).get('qualityReports') as FormArray;
  }

  getPrimaryQualityRow(group: AbstractControl): FormGroup | null {
    const rows = this.getQualityRows(group);
    return (rows?.at(0) as FormGroup) || null;
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
        inhouseReportDocumentUrl: [''],
        inhouseReportDocumentName: [''],
        strategicReportNo: [''],
        strategicReportDate: [null],
        strategicReportDocumentUrl: [''],
        strategicReportDocumentName: [''],
        thirdPartyReportNo: [''],
        thirdPartyReportDate: [null],
        thirdPartyReportDocumentUrl: [''],
        thirdPartyReportDocumentName: [''],
        remarks: [''],
        attachmentDocumentUrl: [''],
        attachmentDocumentName: [''],
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
        remarks: [''],
        documentUrl: [''],
        documentName: [''],
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

  getSavedUrl(row: AbstractControl, kind: QualityDocKind, table: 'qualityRows' | 'qualityReports'): string {
    if (table === 'qualityReports') {
      return row.get('documentUrl')?.value || '';
    }
    const controlName =
      kind === 'inhouse'
        ? 'inhouseReportDocumentUrl'
        : kind === 'strategic'
          ? 'strategicReportDocumentUrl'
          : kind === 'thirdParty'
            ? 'thirdPartyReportDocumentUrl'
            : 'attachmentDocumentUrl';
    return row.get(controlName)?.value || '';
  }

  getSavedName(row: AbstractControl, kind: QualityDocKind, table: 'qualityRows' | 'qualityReports'): string {
    if (table === 'qualityReports') {
      return row.get('documentName')?.value || '';
    }
    const controlName =
      kind === 'inhouse'
        ? 'inhouseReportDocumentName'
        : kind === 'strategic'
          ? 'strategicReportDocumentName'
          : kind === 'thirdParty'
            ? 'thirdPartyReportDocumentName'
            : 'attachmentDocumentName';
    return row.get(controlName)?.value || '';
  }

  openRemoteDocumentPreview(url: string, title: string): void {
    this.previewUrl.set(url);
    this.previewTitle.set(title);
    this.previewIsImage.set(/\.(png|jpe?g|gif|webp)(\?|$)/i.test(url));
    this.showPreviewModal.set(true);
  }

  hasS1Report(): boolean {
    return !!this.shipmentData()?.shipment?.s1QualityReportUrl;
  }

  getQ1ReportData(): any {
    return this.shipmentData()?.shipment?.q1Report || null;
  }

  openS1Report(): void {
    const url = this.shipmentData()?.shipment?.s1QualityReportUrl;
    const name = this.shipmentData()?.shipment?.s1QualityReportName || 'S1 Quality Report';
    if (!url) return;
    this.openRemoteDocumentPreview(url, name);
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

    const qualityRows = this.getQualityRows(group).controls.map((row, rowIndex) => ({
      sn: Number(row.get('sn')?.value) || rowIndex + 1,
      sampleNo: row.get('sampleNo')?.value || '',
      phase: row.get('phase')?.value || 'S1',
      date: toDate(row.get('date')?.value),
      inhouseReportNo: row.get('inhouseReportNo')?.value || '',
      inhouseReportDate: toDate(row.get('inhouseReportDate')?.value),
      inhouseReportDocumentUrl: row.get('inhouseReportDocumentUrl')?.value || '',
      inhouseReportDocumentName: row.get('inhouseReportDocumentName')?.value || '',
      strategicReportNo: row.get('strategicReportNo')?.value || '',
      strategicReportDate: toDate(row.get('strategicReportDate')?.value),
      strategicReportDocumentUrl: row.get('strategicReportDocumentUrl')?.value || '',
      strategicReportDocumentName: row.get('strategicReportDocumentName')?.value || '',
      thirdPartyReportNo: row.get('thirdPartyReportNo')?.value || '',
      thirdPartyReportDate: toDate(row.get('thirdPartyReportDate')?.value),
      thirdPartyReportDocumentUrl: row.get('thirdPartyReportDocumentUrl')?.value || '',
      thirdPartyReportDocumentName: row.get('thirdPartyReportDocumentName')?.value || '',
      remarks: row.get('remarks')?.value || '',
      attachmentDocumentUrl: row.get('attachmentDocumentUrl')?.value || '',
      attachmentDocumentName: row.get('attachmentDocumentName')?.value || '',
    }));

    const formData = new FormData();
    formData.append('qualityRows', JSON.stringify(qualityRows));
    formData.append('qualityReports', JSON.stringify([]));

    this.getQualityRows(group).controls.forEach((row, rowIndex) => {
      const inhouse = this.getFile(index, rowIndex, 'inhouse', 'qualityRows');
      const strategic = this.getFile(index, rowIndex, 'strategic', 'qualityRows');
      const thirdParty = this.getFile(index, rowIndex, 'thirdParty', 'qualityRows');
      const attachment = this.getFile(index, rowIndex, 'attachment', 'qualityRows');
      if (inhouse) formData.append(`qualityRows_${rowIndex}_inhouse`, inhouse, inhouse.name);
      if (strategic) formData.append(`qualityRows_${rowIndex}_strategic`, strategic, strategic.name);
      if (thirdParty) formData.append(`qualityRows_${rowIndex}_thirdParty`, thirdParty, thirdParty.name);
      if (attachment) formData.append(`qualityRows_${rowIndex}_attachment`, attachment, attachment.name);
    });

    this.savingRowIndex.set(index);
    this.shipmentService.submitQualityDetails(containerId, formData).subscribe({
      next: () => {
        this.savingRowIndex.set(null);
        this.notificationService.success('Saved', 'Quality details saved successfully.');
        this.store.dispatch(ShipmentActions.loadShipmentDetail({ id: shipmentId }));
      },
      error: (error) => {
        this.savingRowIndex.set(null);
        this.notificationService.error('Save failed', error.error?.message || 'Could not save quality details.');
      }
    });
  }
}
