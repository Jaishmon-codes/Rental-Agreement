import React, { useState, useEffect, useCallback } from "react";
import { Building2, Plus, Home, MapPin, RefreshCw } from "lucide-react";
import api from "../services/api.js";

export default function PropertiesPanel({ currentUser, onDraftAgreementForUnit }) {
  const [properties, setProperties] = useState([]);
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddProp, setShowAddProp] = useState(false);
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // New property form
  const [title, setTitle] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [propertyType, setPropertyType] = useState("APARTMENT");

  // New unit form
  const [unitNumber, setUnitNumber] = useState("");
  const [rentInr, setRentInr] = useState("");
  const [securityDepositInr, setSecurityDepositInr] = useState("");

  const isLandlord = currentUser?.role === "Property Owner" || currentUser?.role === "Super Admin";

  const selectProperty = useCallback(async (prop) => {
    setSelectedProperty(prop);
    try {
      const unitList = await api.getPropertyUnits(prop.id);
      setUnits(unitList || []);
    } catch (err) {
      console.error("Failed to load units:", err);
    }
  }, []);

  const fetchProperties = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getProperties();
      setProperties(data || []);
      if (data && data.length > 0 && !selectedProperty) {
        selectProperty(data[0]);
      }
    } catch (err) {
      console.error("Failed to load properties:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedProperty, selectProperty]);

  useEffect(() => {
    fetchProperties();
  }, [currentUser, fetchProperties]);

  const handleCreateProperty = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");
    setLoading(true);

    try {
      const newProp = await api.createProperty({
        title,
        address,
        city,
        state,
        postalCode,
        propertyType
      });
      setSuccessMsg(`Property "${newProp.title}" created successfully!`);
      setShowAddProp(false);
      setTitle("");
      setAddress("");
      setCity("");
      setState("");
      setPostalCode("");
      await fetchProperties();
      selectProperty(newProp);
    } catch (err) {
      setErrorMsg(err.message || "Failed to create property");
    } finally {
      setLoading(false);
    }
  };

  const handleAddUnit = async (e) => {
    e.preventDefault();
    if (!selectedProperty) return;
    setErrorMsg("");
    setSuccessMsg("");
    setLoading(true);

    try {
      await api.addUnit(selectedProperty.id, {
        unitNumber,
        rentInr: Number(rentInr),
        securityDepositInr: Number(securityDepositInr)
      });
      setSuccessMsg(`Unit "${unitNumber}" added to ${selectedProperty.title}`);
      setShowAddUnit(false);
      setUnitNumber("");
      setRentInr("");
      setSecurityDepositInr("");
      await selectProperty(selectedProperty);
    } catch (err) {
      setErrorMsg(err.message || "Failed to add unit");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel-container" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: "0 0 0.25rem 0", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Building2 size={24} style={{ color: "var(--accent-cyan)" }} />
            Properties & Units
          </h2>
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.85rem" }}>
            {isLandlord ? "Manage real-estate portfolio, inventory units, and link lease agreements" : "Browse available rental residences and units"}
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button className="btn-outline" onClick={fetchProperties} disabled={loading} style={{ fontSize: "0.85rem", padding: "0.5rem 0.85rem" }}>
            <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
          </button>
          {isLandlord && (
            <button className="btn-primary" onClick={() => setShowAddProp(true)} style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }}>
              <Plus size={16} /> Add Property
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div style={{ background: "rgba(244,63,94,0.15)", border: "1px solid var(--accent-rose)", color: "var(--accent-rose)", padding: "0.75rem", borderRadius: "8px", fontSize: "0.85rem" }}>
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div style={{ background: "rgba(16,185,129,0.15)", border: "1px solid var(--accent-emerald)", color: "var(--accent-emerald)", padding: "0.75rem", borderRadius: "8px", fontSize: "0.85rem" }}>
          {successMsg}
        </div>
      )}

      {/* Add Property Modal Form */}
      {showAddProp && (
        <div className="glass-panel" style={{ padding: "1.5rem", borderRadius: "12px", border: "1px solid var(--border-glow)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
            <h3 style={{ margin: 0, fontSize: "1.1rem" }}>New Property Listing</h3>
            <button onClick={() => setShowAddProp(false)} className="btn-outline" style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}>Cancel</button>
          </div>
          <form onSubmit={handleCreateProperty} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div className="form-group" style={{ gridColumn: "1 / -1" }}>
              <label>Property Name / Building Title</label>
              <input type="text" className="input-field" placeholder="e.g. Cyber Greens Tower C" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="form-group" style={{ gridColumn: "1 / -1" }}>
              <label>Street Address</label>
              <input type="text" className="input-field" placeholder="e.g. DLF Cyber City, Sector 25" value={address} onChange={(e) => setAddress(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>City</label>
              <input type="text" className="input-field" placeholder="e.g. Gurugram" value={city} onChange={(e) => setCity(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>State / Region</label>
              <input type="text" className="input-field" placeholder="e.g. Haryana" value={state} onChange={(e) => setState(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Postal Code</label>
              <input type="text" className="input-field" placeholder="e.g. 122002" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Property Type</label>
              <select className="input-field" value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
                <option value="APARTMENT">Apartment / Flat</option>
                <option value="COMMERCIAL">Commercial Office</option>
                <option value="VILLA">Independent Villa</option>
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
              <button type="button" className="btn-outline" onClick={() => setShowAddProp(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={loading}>Create Property</button>
            </div>
          </form>
        </div>
      )}

      {/* Main Layout: Property List & Unit Details */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: "1.5rem" }}>
        {/* Left: Property Cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)", fontWeight: 600 }}>Properties ({properties.length})</span>
          {properties.length === 0 ? (
            <div className="glass-panel" style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
              No properties registered yet.
            </div>
          ) : (
            properties.map((prop) => (
              <div
                key={prop.id}
                onClick={() => selectProperty(prop)}
                className="glass-panel"
                style={{
                  padding: "1rem",
                  cursor: "pointer",
                  borderRadius: "10px",
                  border: selectedProperty?.id === prop.id ? "1px solid var(--accent-cyan)" : "1px solid var(--border-color)",
                  background: selectedProperty?.id === prop.id ? "rgba(0, 242, 254, 0.05)" : undefined,
                  transition: "all 0.2s ease"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{prop.title}</div>
                  <span style={{
                    fontSize: "0.75rem",
                    padding: "2px 8px",
                    borderRadius: "10px",
                    background: prop.status === "ACTIVE" ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.05)",
                    color: prop.status === "ACTIVE" ? "var(--accent-emerald)" : "var(--text-secondary)"
                  }}>
                    {prop.property_type || "APARTMENT"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "4px" }}>
                  <MapPin size={12} /> {prop.address}, {prop.city}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Right: Selected Property Units */}
        <div className="glass-panel" style={{ padding: "1.25rem", borderRadius: "12px" }}>
          {selectedProperty ? (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", paddingBottom: "0.75rem", borderBottom: "1px solid var(--border-color)" }}>
                <div>
                  <h3 style={{ margin: "0 0 4px 0", fontSize: "1.15rem" }}>{selectedProperty.title} Units</h3>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{selectedProperty.address}, {selectedProperty.city}</span>
                </div>
                {isLandlord && (
                  <button className="btn-primary" onClick={() => setShowAddUnit(true)} style={{ fontSize: "0.8rem", padding: "0.4rem 0.75rem" }}>
                    <Plus size={14} /> Add Unit
                  </button>
                )}
              </div>

              {/* Add Unit Form */}
              {showAddUnit && (
                <form onSubmit={handleAddUnit} style={{ background: "rgba(255,255,255,0.03)", padding: "1rem", borderRadius: "8px", marginBottom: "1rem", border: "1px solid var(--border-color)" }}>
                  <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "0.95rem" }}>Add New Unit</h4>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
                    <div className="form-group">
                      <label>Unit / Flat #</label>
                      <input type="text" className="input-field" placeholder="e.g. 402-B" value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} required />
                    </div>
                    <div className="form-group">
                      <label>Rent (INR / Mo)</label>
                      <input type="number" className="input-field" placeholder="15000" value={rentInr} onChange={(e) => setRentInr(e.target.value)} required />
                    </div>
                    <div className="form-group">
                      <label>Security Deposit (INR)</label>
                      <input type="number" className="input-field" placeholder="30000" value={securityDepositInr} onChange={(e) => setSecurityDepositInr(e.target.value)} required />
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }}>
                    <button type="button" className="btn-outline" onClick={() => setShowAddUnit(false)} style={{ fontSize: "0.8rem" }}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={loading} style={{ fontSize: "0.8rem" }}>Save Unit</button>
                  </div>
                </form>
              )}

              {/* Units List */}
              {units.length === 0 ? (
                <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                  No units currently configured for this property.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {units.map((unit) => (
                    <div key={unit.id} style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid var(--border-color)",
                      padding: "0.85rem 1rem",
                      borderRadius: "8px"
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <Home size={18} style={{ color: "var(--accent-cyan)" }} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Unit {unit.unit_number}</div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                            Rent: ₹{Number(unit.rent_inr).toLocaleString("en-IN")} / mo • Deposit: ₹{Number(unit.security_deposit_inr).toLocaleString("en-IN")}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <span style={{
                          fontSize: "0.75rem",
                          padding: "3px 8px",
                          borderRadius: "8px",
                          background: unit.status === "VACANT" ? "rgba(16,185,129,0.15)" : "rgba(155,81,224,0.15)",
                          color: unit.status === "VACANT" ? "var(--accent-emerald)" : "var(--accent-purple)",
                          fontWeight: 500
                        }}>
                          {unit.status}
                        </span>

                        {isLandlord && onDraftAgreementForUnit && (
                          <button
                            className="btn-outline"
                            onClick={() => onDraftAgreementForUnit(selectedProperty, unit)}
                            style={{ fontSize: "0.75rem", padding: "0.35rem 0.65rem" }}
                          >
                            Draft Lease
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "3rem", color: "var(--text-secondary)" }}>
              Select a property to inspect its inventory units.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
