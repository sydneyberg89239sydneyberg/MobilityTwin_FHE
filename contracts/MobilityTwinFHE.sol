// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MobilityTwinFHE is SepoliaConfig {
    struct EncryptedMobilityData {
        uint256 userId;
        euint32[] homeLocation;      // Encrypted home coordinates
        euint32[] workLocation;      // Encrypted work coordinates
        euint32[] commuteTimes;      // Encrypted daily commute times
        euint32[] transportModes;   // Encrypted transport mode preferences
        uint256 timestamp;
    }
    
    struct PolicySimulation {
        euint32[] policyParameters;  // Encrypted policy parameters
        euint32 predictedImpact;      // Encrypted predicted impact score
        bool isComplete;
    }
    
    struct DecryptedResult {
        uint32 predictedImpact;
        bool isRevealed;
    }
    
    // Contract state
    mapping(uint256 => EncryptedMobilityData) public mobilityData;
    mapping(bytes32 => PolicySimulation) public simulations;
    mapping(bytes32 => DecryptedResult) public decryptedResults;
    
    // Transportation mode definitions
    uint8 constant MODE_WALKING = 0;
    uint8 constant MODE_CYCLING = 1;
    uint8 constant MODE_PUBLIC_TRANSPORT = 2;
    uint8 constant MODE_CAR = 3;
    
    // Decryption requests tracking
    mapping(uint256 => bytes32) private requestToSimulationHash;
    
    // Events
    event DataSubmitted(uint256 indexed userId, uint256 timestamp);
    event SimulationRequested(bytes32 indexed simulationHash);
    event SimulationCompleted(bytes32 indexed simulationHash);
    event ResultRevealed(bytes32 indexed simulationHash);
    
    modifier onlyUser(uint256 userId) {
        // Access control placeholder
        _;
    }
    
    /// @notice Submit encrypted mobility data
    function submitMobilityData(
        uint256 userId,
        euint32[] memory home,
        euint32[] memory work,
        euint32[] memory commuteTimes,
        euint32[] memory transportModes
    ) public onlyUser(userId) {
        require(home.length == 2, "Invalid home location");
        require(work.length == 2, "Invalid work location");
        
        mobilityData[userId] = EncryptedMobilityData({
            userId: userId,
            homeLocation: home,
            workLocation: work,
            commuteTimes: commuteTimes,
            transportModes: transportModes,
            timestamp: block.timestamp
        });
        
        emit DataSubmitted(userId, block.timestamp);
    }
    
    /// @notice Request policy impact simulation
    function requestPolicySimulation(
        uint256 userId,
        euint32[] memory policyParams
    ) public onlyUser(userId) {
        require(mobilityData[userId].timestamp > 0, "No mobility data");
        
        bytes32 simHash = keccak256(abi.encodePacked(userId, block.timestamp));
        emit SimulationRequested(simHash);
    }
    
    /// @notice Store encrypted simulation results
    function storeSimulationResult(
        uint256 userId,
        euint32[] memory policyParams,
        euint32 predictedImpact
    ) public {
        bytes32 simHash = keccak256(abi.encodePacked(userId, policyParams));
        
        simulations[simHash] = PolicySimulation({
            policyParameters: policyParams,
            predictedImpact: predictedImpact,
            isComplete: true
        });
        
        decryptedResults[simHash] = DecryptedResult({
            predictedImpact: 0,
            isRevealed: false
        });
        
        emit SimulationCompleted(simHash);
    }
    
    /// @notice Request decryption of simulation result
    function requestResultDecryption(
        uint256 userId,
        euint32[] memory policyParams
    ) public onlyUser(userId) {
        bytes32 simHash = keccak256(abi.encodePacked(userId, policyParams));
        PolicySimulation storage sim = simulations[simHash];
        require(sim.isComplete, "Simulation not complete");
        require(!decryptedResults[simHash].isRevealed, "Already revealed");
        
        // Prepare ciphertexts for decryption
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(sim.predictedImpact);
        
        // Request decryption
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptSimulationResult.selector);
        requestToSimulationHash[reqId] = simHash;
    }
    
    /// @notice Callback for decrypted simulation result
    function decryptSimulationResult(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        bytes32 simHash = requestToSimulationHash[requestId];
        require(simHash != 0, "Invalid request");
        
        PolicySimulation storage sim = simulations[simHash];
        DecryptedResult storage dResult = decryptedResults[simHash];
        require(!dResult.isRevealed, "Already revealed");
        
        // Verify decryption proof
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        // Process decrypted value
        uint32 impact = abi.decode(cleartexts, (uint32));
        dResult.predictedImpact = impact;
        dResult.isRevealed = true;
        
        emit ResultRevealed(simHash);
    }
    
    /// @notice Calculate commute distance (simplified)
    function calculateCommuteDistance(uint256 userId) public view returns (euint32) {
        EncryptedMobilityData storage data = mobilityData[userId];
        require(data.timestamp > 0, "No mobility data");
        
        // Manhattan distance: |x1 - x2| + |y1 - y2|
        euint32 dx = FHE.sub(data.homeLocation[0], data.workLocation[0]);
        euint32 dy = FHE.sub(data.homeLocation[1], data.workLocation[1]);
        
        // Absolute value using FHE.select
        ebool dxNeg = FHE.lt(dx, FHE.asEuint32(0));
        euint32 absDx = FHE.select(dxNeg, FHE.neg(dx), dx);
        
        ebool dyNeg = FHE.lt(dy, FHE.asEuint32(0));
        euint32 absDy = FHE.select(dyNeg, FHE.neg(dy), dy);
        
        return FHE.add(absDx, absDy);
    }
    
    /// @notice Predict policy impact (simplified model)
    function predictPolicyImpact(
        uint256 userId,
        euint32[] memory policyParams
    ) public view returns (euint32) {
        EncryptedMobilityData storage data = mobilityData[userId];
        require(data.timestamp > 0, "No mobility data");
        
        // Simplified impact model: weighted sum of factors
        euint32 impact = FHE.asEuint32(0);
        
        // Factor 1: Commute distance effect
        euint32 distance = calculateCommuteDistance(userId);
        impact = FHE.add(impact, FHE.mul(distance, policyParams[0]));
        
        // Factor 2: Transport mode effect
        for (uint i = 0; i < data.transportModes.length; i++) {
            impact = FHE.add(impact, FHE.mul(data.transportModes[i], policyParams[i+1]));
        }
        
        // Factor 3: Commute time effect
        euint32 avgCommuteTime = FHE.asEuint32(0);
        for (uint i = 0; i < data.commuteTimes.length; i++) {
            avgCommuteTime = FHE.add(avgCommuteTime, data.commuteTimes[i]);
        }
        avgCommuteTime = FHE.div(avgCommuteTime, FHE.asEuint32(data.commuteTimes.length));
        impact = FHE.add(impact, FHE.mul(avgCommuteTime, policyParams[policyParams.length-1]));
        
        return impact;
    }
    
    /// @notice Get encrypted mobility data
    function getEncryptedMobilityData(uint256 userId) public view returns (
        euint32[] memory home,
        euint32[] memory work,
        euint32[] memory commuteTimes,
        euint32[] memory transportModes
    ) {
        EncryptedMobilityData storage data = mobilityData[userId];
        require(data.timestamp > 0, "No mobility data");
        return (data.homeLocation, data.workLocation, data.commuteTimes, data.transportModes);
    }
    
    /// @notice Get encrypted simulation result
    function getEncryptedSimulationResult(
        uint256 userId,
        euint32[] memory policyParams
    ) public view returns (euint32 predictedImpact) {
        bytes32 simHash = keccak256(abi.encodePacked(userId, policyParams));
        PolicySimulation storage sim = simulations[simHash];
        require(sim.isComplete, "Simulation not complete");
        return sim.predictedImpact;
    }
    
    /// @notice Get decrypted simulation result
    function getDecryptedSimulationResult(
        uint256 userId,
        euint32[] memory policyParams
    ) public view returns (uint32 predictedImpact, bool isRevealed) {
        bytes32 simHash = keccak256(abi.encodePacked(userId, policyParams));
        DecryptedResult storage r = decryptedResults[simHash];
        return (r.predictedImpact, r.isRevealed);
    }
    
    /// @notice Calculate carbon footprint reduction (example)
    function calculateCarbonReduction(
        uint256 userId,
        euint32[] memory policyParams
    ) public view returns (euint32) {
        EncryptedMobilityData storage data = mobilityData[userId];
        require(data.timestamp > 0, "No mobility data");
        
        // Simplified model: reduction based on transport mode shifts
        euint32 reduction = FHE.asEuint32(0);
        
        // Car usage reduction effect
        euint32 carUsage = data.transportModes[MODE_CAR];
        reduction = FHE.add(reduction, FHE.mul(carUsage, policyParams[0]));
        
        // Public transport adoption effect
        euint32 ptUsage = data.transportModes[MODE_PUBLIC_TRANSPORT];
        reduction = FHE.add(reduction, FHE.mul(ptUsage, policyParams[1]));
        
        // Active transport adoption effect
        euint32 activeUsage = FHE.add(
            data.transportModes[MODE_WALKING],
            data.transportModes[MODE_CYCLING]
        );
        reduction = FHE.add(reduction, FHE.mul(activeUsage, policyParams[2]));
        
        return reduction;
    }
    
    /// @notice Estimate time savings (example)
    function estimateTimeSavings(
        uint256 userId,
        euint32[] memory policyParams
    ) public view returns (euint32) {
        EncryptedMobilityData storage data = mobilityData[userId];
        require(data.timestamp > 0, "No mobility data");
        
        // Simplified model: time savings from improved infrastructure
        euint32 savings = FHE.asEuint32(0);
        
        // Public transport improvements
        euint32 ptUsage = data.transportModes[MODE_PUBLIC_TRANSPORT];
        savings = FHE.add(savings, FHE.mul(ptUsage, policyParams[3]));
        
        // Cycling infrastructure improvements
        euint32 cyclingUsage = data.transportModes[MODE_CYCLING];
        savings = FHE.add(savings, FHE.mul(cyclingUsage, policyParams[4]));
        
        return savings;
    }
}