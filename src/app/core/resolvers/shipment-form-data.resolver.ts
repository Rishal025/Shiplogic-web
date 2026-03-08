import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { forkJoin } from 'rxjs';
import { map } from 'rxjs/operators';
import { ItemService } from '../services/item.service';
import { SupplierService } from '../services/supplier.service';
import { Item } from '../models/item.model';
import { Supplier } from '../models/supplier.model';

export interface ShipmentFormData {
  items: Item[];
  suppliers: Supplier[];
}

/**
 * Shipment Form Data Resolver
 * Loads Items and Suppliers before rendering the create shipment page
 * This prevents showing empty dropdowns and improves UX
 * Usage: Add to route config: resolve: { formData: shipmentFormDataResolver }
 */
export const shipmentFormDataResolver: ResolveFn<ShipmentFormData> = () => {
  const itemService = inject(ItemService);
  const supplierService = inject(SupplierService);
  
  // Load both items and suppliers in parallel
  return forkJoin({
    items: itemService.getAllItems(1, 100).pipe(
      map(response => response.items)
    ),
    suppliers: supplierService.getAllSuppliers(1, 100).pipe(
      map(response => response.suppliers)
    )
  });
};
