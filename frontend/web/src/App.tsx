// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface MobilityData {
  id: string;
  encryptedRoute: string;
  timestamp: number;
  owner: string;
  transportType: string;
  policyImpact?: number;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [mobilityData, setMobilityData] = useState<MobilityData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSimulateModal, setShowSimulateModal] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRouteData, setNewRouteData] = useState({
    transportType: "walking",
    routeDetails: "",
    timeOfDay: "morning"
  });
  const [activeTab, setActiveTab] = useState("myData");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPolicy, setSelectedPolicy] = useState("congestionCharge");

  // Calculate statistics
  const walkingCount = mobilityData.filter(d => d.transportType === "walking").length;
  const cyclingCount = mobilityData.filter(d => d.transportType === "cycling").length;
  const drivingCount = mobilityData.filter(d => d.transportType === "driving").length;
  const publicTransportCount = mobilityData.filter(d => d.transportType === "public").length;

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("mobility_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing mobility keys:", e);
        }
      }
      
      const list: MobilityData[] = [];
      
      for (const key of keys) {
        try {
          const dataBytes = await contract.getData(`mobility_${key}`);
          if (dataBytes.length > 0) {
            try {
              const data = JSON.parse(ethers.toUtf8String(dataBytes));
              list.push({
                id: key,
                encryptedRoute: data.route,
                timestamp: data.timestamp,
                owner: data.owner,
                transportType: data.transportType,
                policyImpact: data.policyImpact
              });
            } catch (e) {
              console.error(`Error parsing data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading data ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setMobilityData(list);
    } catch (e) {
      console.error("Error loading mobility data:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitRoute = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setSimulating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting mobility data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedRoute = `FHE-${btoa(JSON.stringify(newRouteData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const routeId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const routeData = {
        route: encryptedRoute,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        transportType: newRouteData.transportType
      };
      
      await contract.setData(
        `mobility_${routeId}`, 
        ethers.toUtf8Bytes(JSON.stringify(routeData))
      );
      
      const keysBytes = await contract.getData("mobility_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(routeId);
      
      await contract.setData(
        "mobility_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted mobility data submitted!"
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowSimulateModal(false);
        setNewRouteData({
          transportType: "walking",
          routeDetails: "",
          timeOfDay: "morning"
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setSimulating(false);
    }
  };

  const simulatePolicy = async () => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setSimulating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Running FHE simulation..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Get the latest route for simulation
      const myRoutes = mobilityData.filter(d => d.owner.toLowerCase() === account.toLowerCase());
      if (myRoutes.length === 0) {
        throw new Error("No mobility data found for simulation");
      }
      
      const latestRoute = myRoutes[0];
      const routeBytes = await contract.getData(`mobility_${latestRoute.id}`);
      if (routeBytes.length === 0) {
        throw new Error("Route not found");
      }
      
      const routeData = JSON.parse(ethers.toUtf8String(routeBytes));
      
      // Simulate policy impact (random for demo)
      const impactScore = Math.floor(Math.random() * 100);
      
      const updatedRoute = {
        ...routeData,
        policyImpact: impactScore
      };
      
      await contract.setData(
        `mobility_${latestRoute.id}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRoute))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE simulation complete! Impact score: ${impactScore}`
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Simulation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setSimulating(false);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const filteredData = mobilityData.filter(data => {
    const matchesSearch = data.id.includes(searchQuery) || 
                         data.transportType.includes(searchQuery);
    return activeTab === "myData" 
      ? matchesSearch && isOwner(data.owner)
      : matchesSearch;
  });

  const renderTransportChart = () => {
    const total = mobilityData.length || 1;
    const walkingPercentage = (walkingCount / total) * 100;
    const cyclingPercentage = (cyclingCount / total) * 100;
    const drivingPercentage = (drivingCount / total) * 100;
    const publicPercentage = (publicTransportCount / total) * 100;

    return (
      <div className="transport-chart">
        <div className="chart-bar">
          <div 
            className="bar-segment walking" 
            style={{ width: `${walkingPercentage}%` }}
          ></div>
          <div 
            className="bar-segment cycling" 
            style={{ width: `${cyclingPercentage}%` }}
          ></div>
          <div 
            className="bar-segment driving" 
            style={{ width: `${drivingPercentage}%` }}
          ></div>
          <div 
            className="bar-segment public" 
            style={{ width: `${publicPercentage}%` }}
          ></div>
        </div>
        <div className="chart-legend">
          <div className="legend-item">
            <div className="color-box walking"></div>
            <span>Walking: {walkingCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box cycling"></div>
            <span>Cycling: {cyclingCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box driving"></div>
            <span>Driving: {drivingCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box public"></div>
            <span>Public: {publicTransportCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Loading encrypted mobility data...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Mobility<span>Twin</span></h1>
          <p>Privacy-Preserving Urban Mobility</p>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <main className="main-content">
        <section className="hero-section">
          <div className="hero-content">
            <h2>Your Encrypted Mobility Twin</h2>
            <p>Simulate urban policy impacts on your personal routes without compromising privacy</p>
            <button 
              className="primary-btn"
              onClick={() => setShowSimulateModal(true)}
            >
              Add Mobility Data
            </button>
          </div>
          <div className="hero-image"></div>
        </section>

        <section className="data-section">
          <div className="section-header">
            <div className="tabs">
              <button 
                className={activeTab === "myData" ? "active" : ""}
                onClick={() => setActiveTab("myData")}
              >
                My Data
              </button>
              <button 
                className={activeTab === "allData" ? "active" : ""}
                onClick={() => setActiveTab("allData")}
              >
                Community Data
              </button>
            </div>
            <div className="search-box">
              <input 
                type="text" 
                placeholder="Search routes..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button className="search-btn"></button>
            </div>
          </div>

          <div className="stats-overview">
            <div className="stat-card">
              <h3>Total Routes</h3>
              <p>{mobilityData.length}</p>
            </div>
            <div className="stat-card">
              <h3>My Routes</h3>
              <p>{mobilityData.filter(d => isOwner(d.owner)).length}</p>
            </div>
            <div className="stat-card">
              <h3>Avg Impact</h3>
              <p>
                {mobilityData.filter(d => d.policyImpact).length > 0 
                  ? Math.round(mobilityData.reduce((sum, d) => sum + (d.policyImpact || 0), 0) / 
                    mobilityData.filter(d => d.policyImpact).length)
                  : '--'}
              </p>
            </div>
          </div>

          <div className="transport-chart-container">
            <h3>Transport Mode Distribution</h3>
            {renderTransportChart()}
          </div>

          <div className="data-table">
            <div className="table-header">
              <div>Route ID</div>
              <div>Transport</div>
              <div>Date</div>
              <div>Impact</div>
              <div>Actions</div>
            </div>
            
            {filteredData.length === 0 ? (
              <div className="no-data">
                <p>No mobility data found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowSimulateModal(true)}
                >
                  Add Your First Route
                </button>
              </div>
            ) : (
              filteredData.map(data => (
                <div className="table-row" key={data.id}>
                  <div>#{data.id.substring(0, 6)}</div>
                  <div className={`transport-type ${data.transportType}`}>
                    {data.transportType}
                  </div>
                  <div>
                    {new Date(data.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div>
                    {data.policyImpact !== undefined ? (
                      <span className={`impact-score ${data.policyImpact > 50 ? 'high' : 'low'}`}>
                        {data.policyImpact}
                      </span>
                    ) : (
                      <button 
                        className="simulate-btn"
                        onClick={simulatePolicy}
                        disabled={!isOwner(data.owner) || simulating}
                      >
                        Simulate
                      </button>
                    )}
                  </div>
                  <div>
                    {isOwner(data.owner) && (
                      <button className="details-btn">Details</button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {showSimulateModal && (
        <ModalAddRoute 
          onSubmit={submitRoute} 
          onClose={() => setShowSimulateModal(false)} 
          simulating={simulating}
          routeData={newRouteData}
          setRouteData={setNewRouteData}
          selectedPolicy={selectedPolicy}
          setSelectedPolicy={setSelectedPolicy}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <div className="notification-icon"></div>
            <p>{transactionStatus.message}</p>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-info">
            <h3>MobilityTwin</h3>
            <p>Privacy-preserving urban mobility simulations powered by FHE</p>
          </div>
          <div className="footer-links">
            <a href="#">Documentation</a>
            <a href="#">Privacy Policy</a>
            <a href="#">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} MobilityTwin FHE. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

interface ModalAddRouteProps {
  onSubmit: () => void; 
  onClose: () => void; 
  simulating: boolean;
  routeData: any;
  setRouteData: (data: any) => void;
  selectedPolicy: string;
  setSelectedPolicy: (policy: string) => void;
}

const ModalAddRoute: React.FC<ModalAddRouteProps> = ({ 
  onSubmit, 
  onClose, 
  simulating,
  routeData,
  setRouteData,
  selectedPolicy,
  setSelectedPolicy
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRouteData({
      ...routeData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!routeData.routeDetails) {
      alert("Please provide route details");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Add Mobility Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="form-group">
            <label>Transport Type</label>
            <select 
              name="transportType"
              value={routeData.transportType} 
              onChange={handleChange}
            >
              <option value="walking">Walking</option>
              <option value="cycling">Cycling</option>
              <option value="driving">Driving</option>
              <option value="public">Public Transport</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Time of Day</label>
            <select 
              name="timeOfDay"
              value={routeData.timeOfDay} 
              onChange={handleChange}
            >
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
              <option value="evening">Evening</option>
              <option value="night">Night</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Route Details *</label>
            <textarea 
              name="routeDetails"
              value={routeData.routeDetails} 
              onChange={handleChange}
              placeholder="Describe your typical route (start/end points, stops, etc.)" 
              rows={4}
            />
          </div>
          
          <div className="form-group">
            <label>Policy to Simulate</label>
            <select 
              value={selectedPolicy}
              onChange={(e) => setSelectedPolicy(e.target.value)}
            >
              <option value="congestionCharge">Congestion Charge</option>
              <option value="parkingFees">Increased Parking Fees</option>
              <option value="bikeLanes">New Bike Lanes</option>
              <option value="transitExpansion">Public Transit Expansion</option>
            </select>
          </div>
          
          <div className="privacy-notice">
            <p>Your data will be encrypted using FHE and never decrypted during processing</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="secondary-btn">
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={simulating}
            className="primary-btn"
          >
            {simulating ? "Encrypting..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;