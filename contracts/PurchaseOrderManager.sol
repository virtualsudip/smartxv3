// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PurchaseOrderManager - Blockchain-backed purchase order lifecycle management
contract PurchaseOrderManager {

    enum Status { Pending, Approved, Rejected, Shipped, Delivered, Cancelled }

    struct Item {
        string  name;
        uint256 quantity;
        uint256 unitPrice; // stored in cents (USD × 100)
    }

    struct PurchaseOrder {
        uint256  id;
        address  creator;
        string   supplierName;
        string   supplierAddress;
        uint256  totalAmount;     // cents
        Status   status;
        string   notes;
        uint256  createdAt;
        uint256  updatedAt;
        uint256  expectedDelivery;
        uint256  itemCount;
    }

    // ── Storage ──────────────────────────────────────────────────────────────
    uint256 private _orderCounter;

    mapping(uint256 => PurchaseOrder) private _orders;
    mapping(uint256 => Item[])        private _orderItems;
    uint256[]                         private _orderIds;

    // Supplier stats (on-chain)
    mapping(string => uint256) public supplierTotalOrders;
    mapping(string => uint256) public supplierApprovedOrders;
    mapping(string => uint256) public supplierDeliveredOrders;

    // ── Events ────────────────────────────────────────────────────────────────
    event OrderCreated(
        uint256 indexed id,
        address indexed creator,
        string  supplierName,
        uint256 totalAmount,
        uint256 timestamp
    );
    event StatusChanged(
        uint256 indexed id,
        Status  oldStatus,
        Status  newStatus,
        address indexed changedBy,
        uint256 timestamp
    );

    // ── Modifiers ─────────────────────────────────────────────────────────────
    modifier orderExists(uint256 id) {
        require(_orders[id].id != 0, "Order does not exist");
        _;
    }

    // ── Write Functions ───────────────────────────────────────────────────────

    function createOrder(
        string   memory supplierName,
        string   memory supplierAddr,
        string[] memory itemNames,
        uint256[] memory quantities,
        uint256[] memory unitPrices,
        string   memory notes,
        uint256  expectedDelivery
    ) external returns (uint256) {
        require(bytes(supplierName).length > 0, "Supplier name required");
        require(itemNames.length > 0,           "At least one item required");
        require(
            itemNames.length == quantities.length &&
            quantities.length == unitPrices.length,
            "Array length mismatch"
        );

        _orderCounter++;
        uint256 id = _orderCounter;

        uint256 total = 0;
        for (uint256 i = 0; i < itemNames.length; i++) {
            require(quantities[i] > 0,  "Quantity must be > 0");
            require(unitPrices[i] > 0,  "Unit price must be > 0");
            _orderItems[id].push(Item(itemNames[i], quantities[i], unitPrices[i]));
            total += quantities[i] * unitPrices[i];
        }

        _orders[id] = PurchaseOrder({
            id:               id,
            creator:          msg.sender,
            supplierName:     supplierName,
            supplierAddress:  supplierAddr,
            totalAmount:      total,
            status:           Status.Pending,
            notes:            notes,
            createdAt:        block.timestamp,
            updatedAt:        block.timestamp,
            expectedDelivery: expectedDelivery,
            itemCount:        itemNames.length
        });

        _orderIds.push(id);
        supplierTotalOrders[supplierName]++;

        emit OrderCreated(id, msg.sender, supplierName, total, block.timestamp);
        return id;
    }

    function updateStatus(uint256 id, Status newStatus)
        external
        orderExists(id)
    {
        Status old = _orders[id].status;
        require(old != newStatus, "Status already set");

        // Enforce valid transitions
        if (newStatus == Status.Approved) {
            require(old == Status.Pending, "Can only approve pending orders");
            supplierApprovedOrders[_orders[id].supplierName]++;
        } else if (newStatus == Status.Rejected) {
            require(old == Status.Pending, "Can only reject pending orders");
        } else if (newStatus == Status.Shipped) {
            require(old == Status.Approved, "Must be approved before shipping");
        } else if (newStatus == Status.Delivered) {
            require(old == Status.Shipped, "Must be shipped before delivery");
            supplierDeliveredOrders[_orders[id].supplierName]++;
        } else if (newStatus == Status.Cancelled) {
            require(
                old == Status.Pending || old == Status.Approved,
                "Cannot cancel at this stage"
            );
        }

        _orders[id].status    = newStatus;
        _orders[id].updatedAt = block.timestamp;

        emit StatusChanged(id, old, newStatus, msg.sender, block.timestamp);
    }

    // ── Read Functions ────────────────────────────────────────────────────────

    function getOrder(uint256 id)
        external
        view
        orderExists(id)
        returns (
            uint256 orderId,
            address creator,
            string  memory supplierName,
            string  memory supplierAddr,
            uint256 totalAmount,
            uint8   status,
            string  memory notes,
            uint256 createdAt,
            uint256 updatedAt,
            uint256 expectedDelivery,
            uint256 itemCount
        )
    {
        PurchaseOrder storage o = _orders[id];
        return (
            o.id, o.creator, o.supplierName, o.supplierAddress,
            o.totalAmount, uint8(o.status), o.notes,
            o.createdAt, o.updatedAt, o.expectedDelivery, o.itemCount
        );
    }

    function getOrderItems(uint256 id)
        external
        view
        orderExists(id)
        returns (
            string[]  memory names,
            uint256[] memory quantities,
            uint256[] memory unitPrices
        )
    {
        Item[] storage items = _orderItems[id];
        names       = new string[](items.length);
        quantities  = new uint256[](items.length);
        unitPrices  = new uint256[](items.length);
        for (uint256 i = 0; i < items.length; i++) {
            names[i]      = items[i].name;
            quantities[i] = items[i].quantity;
            unitPrices[i] = items[i].unitPrice;
        }
    }

    function getOrderCount() external view returns (uint256) { return _orderCounter; }

    function getAllOrderIds() external view returns (uint256[] memory) { return _orderIds; }

    function getSupplierStats(string memory name)
        external
        view
        returns (uint256 total, uint256 approved, uint256 delivered)
    {
        return (
            supplierTotalOrders[name],
            supplierApprovedOrders[name],
            supplierDeliveredOrders[name]
        );
    }
}
