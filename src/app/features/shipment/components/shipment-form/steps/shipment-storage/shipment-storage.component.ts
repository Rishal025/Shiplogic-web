import { Component, Input, effect, inject, signal, computed, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormGroup, ReactiveFormsModule, AbstractControl } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { selectShipmentData } from '../../../../../../store/shipment/shipment.selectors';
import * as ShipmentActions from '../../../../../../store/shipment/shipment.actions';
import { AccordionModule } from 'primeng/accordion';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { SelectModule } from 'primeng/select';
import { DialogModule } from 'primeng/dialog';
import { ShipmentService } from '../../../../../../core/services/shipment.service';
import { NotificationService } from '../../../../../../core/services/notification.service';

@Component({
  selector: 'app-shipment-storage',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    AccordionModule,
    DatePickerModule,
    InputNumberModule,
    InputTextModule,
    ToggleSwitch,
    SelectModule,
    DialogModule,
  ],
  templateUrl: './shipment-storage.component.html',
})
export class ShipmentStorageComponent {
  @Input({ required: true }) formArray!: FormArray;

  @ViewChild('storageRowFileInput') storageRowFileInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('storageGlobalFileInput') storageGlobalFileInputRef?: ElementRef<HTMLInputElement>;

  private store = inject(Store);
  private sanitizer = inject(DomSanitizer);
  private shipmentService = inject(ShipmentService);
  private notificationService = inject(NotificationService);
  readonly shipmentData = toSignal(this.store.select(selectShipmentData));

  // Tab state uses compound key "shipmentIndex-containerIndex"
  readonly activeTabs = signal<Record<string, 'allocation' | 'arrival'>>({});
  readonly expandedContainers = signal<Record<number, boolean>>({});
  readonly savingRowIndex = signal<number | null>(null);
  readonly rowFiles = signal<Record<string, File | null>>({});
  readonly globalFiles = signal<Record<number, File | null>>({});
  readonly previewUrl = signal<string | null>(null);
  readonly previewTitle = signal('');
  readonly previewIsImage = signal(false);
  readonly previewZoom = signal(1);
  readonly previewTransformOrigin = signal('center center');
  readonly showPreviewModal = signal(false);
  readonly previewSafeUrl = computed(() => {
    const url = this.previewUrl();
    if (!url || this.previewIsImage()) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  private pendingRowUpload: { shipmentIndex: number; containerIndex: number } | null = null;

  readonly warehouseOptions = [
    { label: 'Warehouse DIC - RH006', value: 'Warehouse DIC - RH006' },
    { label: 'Warehouse Musaffah- RH001P1', value: 'Warehouse Musaffah- RH001P1' },
  ];

  /** Returns the nested containers FormArray for a given shipment group */
  getContainersArray(group: AbstractControl): AbstractControl[] {
    const containers = (group as FormGroup).get('containers') as FormArray;
    return containers ? containers.controls : [];
  }

  getVisibleContainers(group: AbstractControl, shipmentIndex: number): AbstractControl[] {
    const all = this.getContainersArray(group);
    return this.expandedContainers()[shipmentIndex] ? all : all.slice(0, 5);
  }

  hasHiddenContainers(group: AbstractControl): boolean {
    return this.getContainersArray(group).length > 5;
  }

  toggleContainers(shipmentIndex: number): void {
    this.expandedContainers.update((cur) => ({ ...cur, [shipmentIndex]: !cur[shipmentIndex] }));
  }

  getShipmentNoLabel(index: number): string {
    if (this.formArray?.controls[index] == null) return '–';
    const base = this.shipmentData()?.shipment?.shipmentNo;
    return base?.trim() ? `${base}-${index + 1}` : '–';
  }

  setActiveTab(shipmentIndex: number, containerIndex: number, tab: 'allocation' | 'arrival'): void {
    const key = `${shipmentIndex}-${containerIndex}`;
    this.activeTabs.update((current) => ({ ...current, [key]: tab }));
  }

  getActiveTab(shipmentIndex: number, containerIndex: number): 'allocation' | 'arrival' {
    const key = `${shipmentIndex}-${containerIndex}`;
    return this.activeTabs()[key] ?? 'allocation';
  }

  /** Per-shipment tab (single toggle for all containers in that shipment) */
  setShipmentTab(shipmentIndex: number, tab: 'allocation' | 'arrival'): void {
    this.activeTabs.update((current) => ({ ...current, [`s-${shipmentIndex}`]: tab }));
  }

  getShipmentTab(shipmentIndex: number): 'allocation' | 'arrival' {
    return (this.activeTabs()[`s-${shipmentIndex}`] as 'allocation' | 'arrival') ?? 'allocation';
  }

  private rowFileKey(shipmentIndex: number, containerIndex: number): string {
    return `${shipmentIndex}:${containerIndex}`;
  }

  clickRowFileInput(shipmentIndex: number, containerIndex: number): void {
    this.pendingRowUpload = { shipmentIndex, containerIndex };
    this.storageRowFileInputRef?.nativeElement?.click();
  }

  onRowFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    const pendingUpload = this.pendingRowUpload;
    if (file && pendingUpload) {
      this.rowFiles.update((cur) => ({
        ...cur,
        [this.rowFileKey(pendingUpload.shipmentIndex, pendingUpload.containerIndex)]: file
      }));
    }
    this.pendingRowUpload = null;
    input.value = '';
  }

  getRowFile(shipmentIndex: number, containerIndex: number): File | null {
    return this.rowFiles()[this.rowFileKey(shipmentIndex, containerIndex)] ?? null;
  }

  clearRowFile(shipmentIndex: number, containerIndex: number): void {
    this.rowFiles.update((cur) => ({
      ...cur,
      [this.rowFileKey(shipmentIndex, containerIndex)]: null
    }));
  }

  clickGlobalFileInput(shipmentIndex: number): void {
    const input = this.storageGlobalFileInputRef?.nativeElement;
    if (input) {
      input.dataset['shipmentIndex'] = String(shipmentIndex);
      input.click();
    }
  }

  onGlobalFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    const shipmentIndex = Number(input.dataset['shipmentIndex']);
    if (file && Number.isFinite(shipmentIndex)) {
      this.globalFiles.update((cur) => ({ ...cur, [shipmentIndex]: file }));
    }
    input.value = '';
    delete input.dataset['shipmentIndex'];
  }

  getGlobalFile(shipmentIndex: number): File | null {
    return this.globalFiles()[shipmentIndex] ?? null;
  }

  clearGlobalFile(shipmentIndex: number): void {
    this.globalFiles.update((cur) => ({ ...cur, [shipmentIndex]: null }));
  }

  openDocumentPreview(file: File, title: string): void {
    this.previewUrl.set(URL.createObjectURL(file));
    this.previewTitle.set(title);
    this.previewIsImage.set(file.type.startsWith('image/'));
    this.resetPreviewZoom();
    this.showPreviewModal.set(true);
  }

  openRemoteDocumentPreview(url: string, title: string): void {
    this.previewUrl.set(url);
    this.previewTitle.set(title);
    this.previewIsImage.set(/\.(png|jpe?g|gif|webp)(\?|$)/i.test(url));
    this.resetPreviewZoom();
    this.showPreviewModal.set(true);
  }

  closeDocumentPreview(): void {
    const url = this.previewUrl();
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
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

  getSavedRowDocumentUrl(group: AbstractControl): string {
    return (group as FormGroup).get('documentUrl')?.value || '';
  }

  getSavedRowDocumentName(group: AbstractControl): string {
    return (group as FormGroup).get('documentName')?.value || '';
  }

  getSavedGlobalDocumentUrl(group: AbstractControl): string {
    return (group as FormGroup).get('storageDocumentUrl')?.value || '';
  }

  getSavedGlobalDocumentName(group: AbstractControl): string {
    return (group as FormGroup).get('storageDocumentName')?.value || '';
  }

  private toDate(value: unknown): string {
    return value ? new Date(value as string | Date).toISOString().split('T')[0] : '';
  }

  private toTime(value: unknown): string {
    if (!value) return '';
    if (value instanceof Date) {
      const hours = String(value.getHours()).padStart(2, '0');
      const minutes = String(value.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    }
    return String(value);
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

    const formData = new FormData();
    const containers = this.getContainersArray(group).map((control, containerIndex) => {
      const row = control as FormGroup;
      const rowFile = this.getRowFile(index, containerIndex);
      if (rowFile) {
        formData.append(`storageSplits_${containerIndex}_document`, rowFile, rowFile.name);
      }
      return {
        containerSerialNo: row.get('containerSerialNo')?.value || '',
        bags: Number(row.get('bags')?.value) || 0,
        warehouse: row.get('warehouse')?.value || '',
        storageAvailability: Number(row.get('storageAvailability')?.value) || 0,
        receivedOnDate: this.toDate(row.get('receivedOnDate')?.value),
        receivedOnTime: this.toTime(row.get('receivedOnTime')?.value),
        customsInspection: row.get('customsInspection')?.value || 'No',
        grn: row.get('grn')?.value || '',
        batch: row.get('batch')?.value || '',
        productionDate: this.toDate(row.get('productionDate')?.value),
        expiryDate: this.toDate(row.get('expiryDate')?.value),
        remarks: row.get('remarks')?.value || '',
        documentUrl: row.get('documentUrl')?.value || '',
        documentName: row.get('documentName')?.value || '',
      };
    });

    const globalFile = this.getGlobalFile(index);
    if (globalFile) {
      formData.append('storageDocument', globalFile, globalFile.name);
    }
    formData.append('storageSplits', JSON.stringify(containers));

    this.savingRowIndex.set(index);
    this.shipmentService.submitStorageDetails(containerId, formData).subscribe({
      next: () => {
        this.savingRowIndex.set(null);
        this.getContainersArray(group).forEach((control, containerIndex) => {
          if (this.getRowFile(index, containerIndex)) this.clearRowFile(index, containerIndex);
        });
        if (globalFile) this.clearGlobalFile(index);
        this.notificationService.success('Saved', 'Storage details saved successfully.');
        this.store.dispatch(ShipmentActions.loadShipmentDetail({ id: shipmentId }));
      },
      error: (error) => {
        this.savingRowIndex.set(null);
        this.notificationService.error('Save failed', error.error?.message || 'Could not save storage details.');
      }
    });
  }
}
