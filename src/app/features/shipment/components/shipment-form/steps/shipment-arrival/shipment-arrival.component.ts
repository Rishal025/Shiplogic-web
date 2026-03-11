import { Component, Input, inject, effect, signal, computed, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormArray, FormBuilder, AbstractControl } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { ConfirmationService } from 'primeng/api';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { AccordionModule } from 'primeng/accordion';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import {
  selectShipmentData,
  selectSubmittedStep3Indices,
  selectSubmittedStep4Indices,
  selectSubmittingRowIndex,
} from '../../../../../../store/shipment/shipment.selectors';
import * as ShipmentActions from '../../../../../../store/shipment/shipment.actions';

export type Step4DocKind = 'deliveryOrder' | 'token' | 'transportArranged' | 'customsClearance' | 'municipalityClearance';

const STEP4_DOC_CONFIG: { kind: Step4DocKind; label: string; dateControl: string }[] = [
  { kind: 'deliveryOrder', label: 'Delivery Order', dateControl: 'deliveryOrderDate' },
  { kind: 'token', label: 'Token', dateControl: 'tokenDate' },
  { kind: 'transportArranged', label: 'Transport Arranged', dateControl: 'transportArrangedDate' },
  { kind: 'customsClearance', label: 'Customs Clearance', dateControl: 'customsClearanceDate' },
  { kind: 'municipalityClearance', label: 'Municipality Clearance', dateControl: 'municipalityClearanceDate' },
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
  ],
  providers: [ConfirmationService],
  templateUrl: './shipment-arrival.component.html',
})
export class ShipmentArrivalComponent {
  @Input({ required: true }) formArray!: FormArray;

  readonly step4DocConfig = STEP4_DOC_CONFIG;

  @ViewChild('deliveryOrderInput') deliveryOrderInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('tokenInput') tokenInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('transportArrangedInput') transportArrangedInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('customsClearanceInput') customsClearanceInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('municipalityClearanceInput') municipalityClearanceInputRef?: ElementRef<HTMLInputElement>;

  private pendingFileRow: number | null = null;
  private pendingDocKind: Step4DocKind | null = null;

  readonly shipmentData = toSignal(inject(Store).select(selectShipmentData));

  readonly deliveryOrderFile = signal<Record<number, File | null>>({});
  readonly tokenFile = signal<Record<number, File | null>>({});
  readonly transportArrangedFile = signal<Record<number, File | null>>({});
  readonly customsClearanceFile = signal<Record<number, File | null>>({});
  readonly municipalityClearanceFile = signal<Record<number, File | null>>({});

  showPreviewModal = signal(false);
  previewUrl = signal<string | null>(null);
  previewTitle = signal('');
  previewIsImage = signal(false);
  previewSafeUrl = computed(() => {
    const url = this.previewUrl();
    if (!url || this.previewIsImage()) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  private store = inject(Store);
  private fb = inject(FormBuilder);
  private confirmationService = inject(ConfirmationService);
  private sanitizer = inject(DomSanitizer);

  readonly submittedIndices = toSignal(this.store.select(selectSubmittedStep4Indices), { initialValue: [] });
  readonly precedingIndices = toSignal(this.store.select(selectSubmittedStep3Indices), { initialValue: [] });
  readonly submittingRowIndex = toSignal(this.store.select(selectSubmittingRowIndex), { initialValue: null });

  constructor() {
    effect(() => {
      this.submittedIndices().forEach((idx) => {
        if (this.formArray?.at(idx)) this.formArray.at(idx).disable({ emitEvent: false });
      });
    });
  }

  getShipmentNoLabel(index: number): string {
    if (this.formArray?.controls[index] == null) return '–';
    const base = this.shipmentData()?.shipment?.shipmentNo;
    return base?.trim() ? `${base}-${index + 1}` : '–';
  }

  getFileSignal(kind: Step4DocKind) {
    switch (kind) {
      case 'deliveryOrder': return this.deliveryOrderFile;
      case 'token': return this.tokenFile;
      case 'transportArranged': return this.transportArrangedFile;
      case 'customsClearance': return this.customsClearanceFile;
      case 'municipalityClearance': return this.municipalityClearanceFile;
    }
  }

  getFile(containerIndex: number, kind: Step4DocKind): File | null {
    return this.getFileSignal(kind)()?.[containerIndex] ?? null;
  }

  clickFileInput(index: number, kind: Step4DocKind): void {
    if (this.isRowSubmitted(index)) return;
    this.pendingFileRow = index;
    this.pendingDocKind = kind;
    const refs: Record<Step4DocKind, ElementRef<HTMLInputElement> | undefined> = {
      deliveryOrder: this.deliveryOrderInputRef,
      token: this.tokenInputRef,
      transportArranged: this.transportArrangedInputRef,
      customsClearance: this.customsClearanceInputRef,
      municipalityClearance: this.municipalityClearanceInputRef,
    };
    refs[kind]?.nativeElement?.click();
  }

  onFileInputChange(event: Event, kind: Step4DocKind): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    const row = this.pendingFileRow;
    if (row !== null && this.pendingDocKind === kind && file) {
      this.getFileSignal(kind).update((cur) => ({ ...cur, [row]: file }));
    }
    this.pendingFileRow = null;
    this.pendingDocKind = null;
    input.value = '';
  }

  clearFile(containerIndex: number, kind: Step4DocKind): void {
    this.getFileSignal(kind).update((cur) => ({ ...cur, [containerIndex]: null }));
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

  isRowSubmitted(index: number): boolean {
    return this.submittedIndices().includes(index);
  }

  isPrecedingSubmitted(index: number): boolean {
    return this.precedingIndices().includes(index);
  }

  getDeliverySchedules(group: AbstractControl): FormArray {
    return group.get('deliverySchedules') as FormArray;
  }

  getWarehouseSchedules(group: AbstractControl): FormArray {
    return group.get('warehouseSchedules') as FormArray;
  }

  addDeliverySchedule(group: AbstractControl, containerIndex: number): void {
    if (this.isRowSubmitted(containerIndex)) return;
    this.getDeliverySchedules(group).push(
      this.fb.group({
        deliveryDate: [null],
        deliveryNo: [''],
        noOfFCL: [null],
        time: [''],
        location: [''],
      })
    );
  }

  removeDeliverySchedule(group: AbstractControl, scheduleIndex: number): void {
    this.getDeliverySchedules(group).removeAt(scheduleIndex);
  }

  addWarehouseSchedule(group: AbstractControl, containerIndex: number): void {
    if (this.isRowSubmitted(containerIndex)) return;
    this.getWarehouseSchedules(group).push(
      this.fb.group({
        deliveryDate: [null],
        deliveryNo: [''],
        noOfFCL: [null],
        time: [''],
        location: [''],
        grn: [''],
      })
    );
  }

  removeWarehouseSchedule(group: AbstractControl, scheduleIndex: number): void {
    this.getWarehouseSchedules(group).removeAt(scheduleIndex);
  }

  confirmSubmit(index: number): void {
    const row = this.formArray.at(index);
    if (row.invalid || !this.isPrecedingSubmitted(index)) return;

    this.confirmationService.confirm({
      message: `Submit Shipment Clearing for Container #${index + 1}?`,
      header: 'Submit Shipment Clearing',
      accept: () => {
        const formValue = row.getRawValue();
        const containerId = formValue['containerId'];
        if (!containerId) return;

        const toDate = (val: unknown) => (val ? new Date(val as Date).toISOString().split('T')[0] : '');

        const deliverySchedules = (formValue['deliverySchedules'] || []).map((ds: any) => ({
          deliveryDate: toDate(ds.deliveryDate),
          deliveryNo: ds.deliveryNo || '',
          noOfFCL: ds.noOfFCL,
          time: ds.time || '',
          location: ds.location || '',
        }));
        const warehouseSchedules = (formValue['warehouseSchedules'] || []).map((ws: any) => ({
          deliveryDate: toDate(ws.deliveryDate),
          deliveryNo: ws.deliveryNo || '',
          noOfFCL: ws.noOfFCL,
          time: ws.time || '',
          location: ws.location || '',
          grn: ws.grn || '',
        }));

        this.store.dispatch(
          ShipmentActions.submitLogistics({
            containerId,
            index,
            payload: {
              deliveryOrderDocumentUrl: '', // S3 later
              deliveryOrderDate: toDate(formValue['deliveryOrderDate']),
              tokenDocumentUrl: '',
              tokenDate: toDate(formValue['tokenDate']),
              transportArrangedDocumentUrl: '',
              transportArrangedDate: toDate(formValue['transportArrangedDate']),
              customsClearanceDocumentUrl: '',
              customsClearanceDate: toDate(formValue['customsClearanceDate']),
              municipalityClearanceDocumentUrl: '',
              municipalityClearanceDate: toDate(formValue['municipalityClearanceDate']),
              deliverySchedules,
              warehouseSchedules,
            },
          })
        );
      },
    });
  }
}
