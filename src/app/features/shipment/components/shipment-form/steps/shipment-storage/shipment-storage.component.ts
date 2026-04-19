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
import { SelectModule } from 'primeng/select';
import { DialogModule } from 'primeng/dialog';
import { ShipmentService } from '../../../../../../core/services/shipment.service';
import { NotificationService } from '../../../../../../core/services/notification.service';
import { WarehouseService } from '../../../../../../core/services/warehouse.service';
import { ConfirmDialogService } from '../../../../../../core/services/confirm-dialog.service';

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
  private warehouseService = inject(WarehouseService);
  private confirmDialog = inject(ConfirmDialogService);
  readonly shipmentData = toSignal(this.store.select(selectShipmentData));

  constructor() {
    this.warehouseService.getWarehouses().subscribe({
      next: (warehouses) => {
        const activeWarehouses = warehouses
          .filter((warehouse) => warehouse.status === 'Active')
          .map((warehouse) => {
            const codeSuffix = warehouse.code ? ` - ${warehouse.code}` : '';
            const label = `${warehouse.name}${codeSuffix}`;
            return { label, value: label };
          });
        this.warehouseOptions.set(activeWarehouses);
      },
    });

    effect(() => {
      const data = this.shipmentData();
      if (!data || !this.formArray || this.formArray.length === 0) return;

      const now = new Date();
      this.formArray.controls.forEach((group: AbstractControl, i: number) => {
        const containers = this.getContainersArray(group);
        const actualRow = data.actual?.[i];
        if (!actualRow) return;

        containers.forEach((rowGroup: AbstractControl) => {
          const row = rowGroup as FormGroup;
          
          // 1. Default Received On Date/Time
          if (!row.get('receivedOnDate')?.value) {
            row.get('receivedOnDate')?.patchValue(now, { emitEvent: false });
          }
          if (!row.get('receivedOnTime')?.value) {
            row.get('receivedOnTime')?.patchValue(now, { emitEvent: false });
          }

          // 2. Populate Production/Expiry from actual data (Packaging List source)
          if (!row.get('productionDate')?.value && actualRow.packagingDate) {
            row.get('productionDate')?.patchValue(new Date(actualRow.packagingDate), { emitEvent: false });
          }
          
          // Check expiry in ActualContainer level or inside packagingList object
          const expirySource = actualRow.expiryDate || actualRow.packagingList?.expiryDate;
          if (!row.get('expiryDate')?.value && expirySource) {
            row.get('expiryDate')?.patchValue(new Date(expirySource), { emitEvent: false });
          }
        });
      });
    });
  }

  // Tab state uses compound key "shipmentIndex-containerIndex"
  readonly activeTabs = signal<Record<string, 'allocation' | 'arrival'>>({});
  readonly expandedContainers = signal<Record<number, boolean>>({});
  readonly savingRowKey = signal<string | null>(null);
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

  readonly warehouseOptions = signal<Array<{ label: string; value: string }>>([]);

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
    const base = this.shipmentData()?.shipment?.shipmentNo?.replace(/\([^)]*\)/g, '').trim();
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

  private saveRowKey(shipmentIndex: number, containerIndex: number): string {
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

  isSavingArrivalRow(shipmentIndex: number, containerIndex: number): boolean {
    return this.savingRowKey() === this.saveRowKey(shipmentIndex, containerIndex);
  }

  async saveArrivalRow(index: number, containerIndex: number): Promise<void> {
    const group = this.formArray.at(index) as FormGroup | null;
    const shipmentId = this.shipmentData()?.shipment?._id;
    if (!group || !shipmentId) return;

    const containerId = group.get('containerId')?.value;
    if (!containerId) {
      this.notificationService.warn('Missing container', 'This shipment row is not linked to a container yet.');
      return;
    }

    const confirmed = await this.confirmDialog.ask({
      message: `Save storage arrival details for Container ${containerIndex + 1}?`,
      header: 'Save Storage Arrival',
      acceptLabel: 'Yes, Save',
    });
    if (!confirmed) return;

    const row = this.getContainersArray(group)[containerIndex] as FormGroup | undefined;
    if (!row) return;

    // Validate required storage arrival fields
    const receivedOnDate = row.get('receivedOnDate')?.value;
    const receivedOnTime = row.get('receivedOnTime')?.value;
    const grn = String(row.get('grn')?.value || '').trim();
    const batch = String(row.get('batch')?.value || '').trim();
    const productionDate = row.get('productionDate')?.value;
    const expiryDate = row.get('expiryDate')?.value;

    const missingArrivalFields: string[] = [];
    if (!receivedOnDate) missingArrivalFields.push('Received On Date');
    if (!receivedOnTime) missingArrivalFields.push('Received On Time');
    if (!grn) missingArrivalFields.push('GRN #');
    if (!batch) missingArrivalFields.push('Batch #');
    if (!productionDate) missingArrivalFields.push('Production Date');
    if (!expiryDate) missingArrivalFields.push('Expiry Date');

    if (missingArrivalFields.length > 0) {
      this.notificationService.error('Required Fields Missing', `Please fill: ${missingArrivalFields.join(', ')}`);
      return;
    }

    const formData = new FormData();
    const rowFile = this.getRowFile(index, containerIndex);
    if (rowFile) {
      formData.append('storageRowDocument', rowFile, rowFile.name);
    }
    formData.append('containerSerialNo', row.get('containerSerialNo')?.value || '');
    formData.append('bags', String(Number(row.get('bags')?.value) || 0));
    formData.append('warehouse', row.get('warehouse')?.value || '');
    formData.append('storageAvailability', String(Number(row.get('storageAvailability')?.value) || 0));
    formData.append('receivedOnDate', this.toDate(row.get('receivedOnDate')?.value));
    formData.append('receivedOnTime', this.toTime(row.get('receivedOnTime')?.value));
    formData.append('customsInspection', row.get('customsInspection')?.value || 'No');
    formData.append('grn', row.get('grn')?.value || '');
    formData.append('batch', row.get('batch')?.value || '');
    formData.append('productionDate', this.toDate(row.get('productionDate')?.value));
    formData.append('expiryDate', this.toDate(row.get('expiryDate')?.value));
    formData.append('remarks', row.get('remarks')?.value || '');
    formData.append('documentUrl', row.get('documentUrl')?.value || '');
    formData.append('documentName', row.get('documentName')?.value || '');

    this.savingRowKey.set(this.saveRowKey(index, containerIndex));
    this.shipmentService.submitStorageArrivalRow(containerId, containerIndex, formData).subscribe({
      next: () => {
        this.savingRowKey.set(null);
        if (rowFile) this.clearRowFile(index, containerIndex);
        this.notificationService.success('Saved', `Storage arrival row ${containerIndex + 1} saved successfully.`);
        this.store.dispatch(ShipmentActions.loadShipmentDetail({ id: shipmentId }));
      },
      error: (error) => {
        this.savingRowKey.set(null);
        this.notificationService.error('Save failed', error.error?.message || 'Could not save storage arrival row.');
      }
    });
  }
}
