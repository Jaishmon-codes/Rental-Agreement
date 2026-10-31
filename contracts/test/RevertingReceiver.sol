// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../RentalAgreement.sol";

/**
 * @title RevertingReceiver
 * @dev Malicious or poorly implemented contract that reverts when receiving ETH.
 * Used to verify CRIT-03 DoS immunity via Pull-over-Push withdrawal pattern.
 */
contract RevertingReceiver {
    bool public shouldRevert = true;

    receive() external payable {
        if (shouldRevert) {
            revert("ReceiverRevert: Maliciously rejecting ETH push");
        }
    }

    function setShouldRevert(bool _revert) external {
        shouldRevert = _revert;
    }

    function join(address agreementAddr) external payable {
        RentalAgreement(agreementAddr).joinAsTenant{value: msg.value}();
    }

    function callWithdrawRefund(address agreementAddr) external {
        RentalAgreement(agreementAddr).withdrawRefund();
    }
}
