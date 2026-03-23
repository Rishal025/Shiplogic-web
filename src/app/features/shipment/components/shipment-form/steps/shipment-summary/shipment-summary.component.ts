import { Component, Input, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, AbstractControl } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { InputNumberModule } from 'primeng/inputnumber';
import { TagModule } from 'primeng/tag';
import { selectShipmentData, selectIsPlannedLocked } from '../../../../../../store/shipment/shipment.selectors';

@Component({
  selector: 'app-shipment-summary',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputNumberModule, TagModule],
  templateUrl: './shipment-summary.component.html',
})
export class ShipmentSummaryComponent {
  @Input({ required: true }) plannedContainersControl!: AbstractControl;

  private store = inject(Store);
  private sanitizer = inject(DomSanitizer);

  readonly shipmentData = toSignal(this.store.select(selectShipmentData));
  readonly isPlannedLocked = toSignal(this.store.select(selectIsPlannedLocked), {
    initialValue: false,
  });
  readonly showPreviewModal = signal(false);
  readonly previewUrl = signal<string | null>(null);
  readonly previewTitle = signal('');
  readonly previewIsImage = signal(false);
  readonly previewSafeUrl = computed(() => {
    const url = this.previewUrl();
    if (!url || this.previewIsImage()) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  openDocument(url?: string | null, title = 'Document'): void {
    if (!url) return;
    this.previewUrl.set(url);
    this.previewTitle.set(title);
    this.previewIsImage.set(this.isImageUrl(url));
    this.showPreviewModal.set(true);
  }

  closePreviewModal(): void {
    this.showPreviewModal.set(false);
    this.previewUrl.set(null);
    this.previewTitle.set('');
    this.previewIsImage.set(false);
  }

  private isImageUrl(url: string): boolean {
    const clean = url.split('?')[0].toLowerCase();
    return /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/.test(clean);
  }
}
