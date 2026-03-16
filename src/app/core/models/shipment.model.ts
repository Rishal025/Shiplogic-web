export interface Shipment {
  _id: string;
  year: number;
  shipmentNo: string;
  orderDate: string;
  supplier: string;
  item: string;
  piNo: string;
  split: number;
  status: string;
  totalAmount: number;
}

export interface ShipmentListResponse {
  page: number;
  limit: number;
  totalPages: number;
  totalRecords: number;
  shipments: Shipment[];
}

// Create Shipment Payload
export interface CreateShipmentPayload {
  poNumber: string;              // Shipment No.
  year: string;                  // Year (not shown in UI)
  orderDate: string;             // Order Date (YYYY-MM-DD)
  supplierId: string;            // Supplier ID from dropdown
  itemId?: string;               // Item ID from dropdown (optional)
  plannedQtyMT: string;          // Planned Quantity MT
  estimatedContainerCount: string; // Planned Containers
  estimatedContainerSize: string;  // Container Size
  plannedETD: string;            // Planned ETD (YYYY-MM-DD)
  plannedETA: string;            // Expected ETA (YYYY-MM-DD)
  piNo: string;                  // PI No.
  fcPerUnit: string;             // FC per Unit
  totalFC: string;               // Estimated Total FC
  amountAED: string;             // Converted AED value
  advanceAmount: number;         // Advance Amount
  totalAmount: string;           // Total Amount
  incoterms?: string;            // Inco Terms
  buyunit?: string;           // Buying Unit (MT/Bag)
  paymentTerms?: string;         // Payment Terms
  splitContainers?: string;      // Split Containers
  totalSplitQtyMT?: string;      // Total Split Quantity MT (from Split Containers)
}

// Create Shipment Response
export interface CreateShipmentResponse {
  message: string;
  data: {
    poNumber: string;
    year: number;
    supplierId: string;
    itemId?: string;
    shipmentNo: string;
    plannedQtyMT: number;
    piNo: string;
    totalSplitQtyMT: number;
    actualContainerCount: number;
    isFullySplit: boolean;
    orderDate: string;
    plannedETD: string;
    plannedETA: string;
    fcPerUnit: number;
    totalFC: number;
    amountAED: number;
    advanceAmount: number;
    payment: {
      totalAmount: number;
      paidAmount: number;
      balanceAmount: number;
      paymentStatus: string;
    };
    currentStage: string;
    _id: string;
    createdAt: string;
    updatedAt: string;
    __v: number;
  };
}

/**
 * Shipment calculations from extraction API (Python shipment_calculations).
 * Used to show FCL, pallets, bags and price-matching warning.
 */
export interface ShipmentCalculations {
  fcl?: number;
  bags?: number;
  container_size?: string;
  bags_per_container?: number;
  pallets?: number;
  is_price_matching?: boolean;
  lpo_price_per_mt?: number;
  pi_price_per_mt?: number;
  mt_variation?: number;
  diff_percent?: number;
}

/**
 * Response from document extraction API (POST /shipment/extract-documents).
 * Used to autopopulate shipment form from uploaded PI/PO documents.
 * Keys match Create New Shipment form controls; supplier/item are resolved from supplierCode/itemCode.
 */
export interface ExtractedShipmentData {
  // Shipment info
  piNo?: string;
  piDate?: string;
  fpoNo?: string;
  purchaseDate?: string;
  incoTerms?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  commodity?: string;
  brandName?: string;
  itemDescription?: string;
  // Supplier (frontend resolves to supplier _id via supplierCode or supplierName)
  supplierCode?: string;
  supplierName?: string;
  countryOfOrigin?: string;
  // Item (frontend resolves to item _id via itemCode or itemDescription)
  itemCode?: string;
  // Quantity & packaging
  packagingType?: string;
  containerSize?: string;
  plannedContainers?: number;
  fcl?: number;
  pallet?: number;
  bags?: number;
  noOfShipments?: number;
  // Price & payment
  buyingUnit?: string;
  fcPerUnit?: number;
  totalUSD?: number;
  totalAED?: number;
  paymentTerms?: string;
  advanceAmount?: number;
  // Dates
  expectedETD?: string;
  expectedETA?: string;
  /** From Python shipment_calculations; used for FCL/pallet/bags and price-mismatch warning. */
  shipmentCalculations?: ShipmentCalculations;
}

export interface ExtractShipmentFromDocumentsResponse {
  message?: string;
  data?: ExtractedShipmentData;
}

/** Response from bill-no extraction API (POST /shipment/extract-bill-no). */
export interface ExtractBillNoResponse {
  bill_no: string;
  metadata?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cost_incurred?: number;
    cost_currency?: string;
    latency_ms?: number;
    model?: string;
  };
}

// Shipment Details API Response (GET /shipment/:id)
export interface ShipmentDetailsResponse {
  shipment: ShipmentInfo;
  planned: PlannedContainer[];
  actual: ActualContainer[];
}

export interface ShipmentInfo {
  _id: string;
  shipmentNo: string;
  orderDate: string;
  orderNumber?: string;
  poNumber?: string;
  fpoNo?: string;
  supplier: string;
  item: string;
  riceName?: string;
  packing?: string;
  piNo: string;
  plannedQtyMT: number;
  assumedContainerCount: number;
  currentStage: string;
  payment: number;
  incoterms?: string;
  buyunit?: string;
  fcPerUnit?: number;
  advanceAmount?: number;
  paymentTerms?: string;
  plannedETD?: string;
  plannedETA?: string;
  containerSize?: number;
  noOfShipments?: number;
}

// Step 1: Planned Split
export interface PlannedContainer {
  containerId: string;
  size: string;
  FCL: number;
  qtyMT: number;
  bags: number;
  weekWiseShipment: string;
  etd?: string;
  eta?: string;
  buyingUnit: string;
  status: 'Planned' | 'Actual' | 'Documentation' | 'Arrival' | 'Clearance Paid' | 'Clearance Final' | 'GRN';
}

export interface DeliverySchedule {
  deliveryDate?: string;
  deliveryNo?: string;
  noOfFCL?: number;
  time?: string;
  location?: string;
}

export interface WarehouseSchedule extends DeliverySchedule {
  grn?: string;
}

// Steps 2-7: Actual Container Data
export interface ActualContainer {
  containerId: string;
  size?: string;
  // Step 2: Actual Split
  qtyMT?: number;
  bags?: number;
  pallet?: number;
  FCL?: number;
  weekWiseShipment?: string;
  buyingUnit?: string;
  receivedOn?: string;
  updatedETD?: string;
  updatedETA?: string;
  BLNo?: string;
  // Step 3: Documentation — Purchase
  DHL?: string;
  docArrivalNotes?: string;
  expectedDocDate?: string;
  receiver?: string;
  // Step 3: Documentation — FAS
  bankAdvanceAmountDocumentUrl?: string;
  bankAdvanceApprovedDocumentUrl?: string;
  bankAdvanceSubmittedOn?: string;
  docToBeReleasedOn?: string;
  // Step 3: Documentation — Logistics (legacy)
  documentCollectedOn?: string;
  // Legacy
  bankAdvanceAmount?: number;
  // Step 4: Shipment Clearing Tracker
  deliveryOrderDocumentUrl?: string;
  deliveryOrderDate?: string;
  tokenDocumentUrl?: string;
  tokenDate?: string;
  transportArrangedDocumentUrl?: string;
  transportArrangedDate?: string;
  customsClearanceDocumentUrl?: string;
  customsClearanceDate?: string;
  municipalityClearanceDocumentUrl?: string;
  municipalityClearanceDate?: string;
  deliverySchedules?: DeliverySchedule[];
  warehouseSchedules?: WarehouseSchedule[];
  // Step 4 legacy
  clearExpectedOn?: string;
  shipmentArrivedOn?: string;
  // Step 4: Arrival — Warehouse (legacy single fields)
  warehouseReceivedOn?: string;
  warehouseGrnNo?: string;
  qualityInspectionReportDate?: string;
  // Step 5: Clearance Paid
  paid_amount?: number;
  paidOn?: string;
  remarks?: string;
  // Step 6: Clearance Final
  clearance?: {
    clearedOn: string;
    remarks: string;
    warehouse: string;
  };
  // Step 7: GRN
  grn?: {
    grnNo: string;
    grnDate: string;
    statusRemarks: string;
  };
}

// Legacy interfaces for form/detail views (keep for backward compatibility)
export interface ShipmentDetail {
  id?: string;
  shipmentNo: string;
  piNo?: string;
  fpoNo?: string;
  incoTerms?: string;
  item?: { label: string; value: string };
  supplier?: { label: string; value: string };
  countryOfOrigin?: string;
  itemDescription?: string;
  packagingType?: { label: string; value: string };
  containerSize?: string;
  status?: string;
  
  // Financials
  paymentTerms?: { label: string; value: string };
  plannedContainers: number;
  fcPerUnit: number;
  estimatedTotalFC: number;
  advanceAmount?: number;
  
  // Dates
  expectedETD?: Date;
  expectedETA?: Date;

  // Step 2 Splits
  plannedSplits: PlannedSplit[];
  actualSplits: ActualSplit[];
  documentationSplits: DocumentationSplit[];
  arrivalTimeSplits: ArrivalTimeSplit[];
  clearancePaidSplits: ClearancePaidSplit[];
  clearanceFinalSplits: ClearanceFinalSplit[];
  grnSplits: GrnSplit[];
}

export interface PlannedSplit {
  size: number;
  qtyMT: number;
  bags: number;
  weekWiseShipment: string;
  FCL: number;
  etd?: Date;
  eta?: Date;
}

export interface ActualSplit {
  size?: number;
  qtyMT: number;
  bags?: number;
  weekWiseShipment?: string;
  FCL?: number;
  updatedETD?: Date;
  updatedETA?: Date;
  BLNo: string;
}

export interface DocumentationSplit {
  DHL: string;
  docArrivalNotes?: string;
  BLNo: string;
}

export interface ArrivalTimeSplit {
  shipmentArrivedOn: Date;
  clearExpectedOn: Date;
}

export interface ClearancePaidSplit {
  paid_amount: number;
  paidOn: Date;
  remarks?: string;
}

export interface ClearanceFinalSplit {
  clearedOn: Date;
  remarks?: string;
  warehouse: string;
}

export interface GrnSplit {
  grnNo: string;
  grnDate: Date;
  statusRemarks?: string;
}
