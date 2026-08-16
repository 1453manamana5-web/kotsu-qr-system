import {
  type MemberCard,
} from "../memberFirestore";

import TicketDesigner from "./TicketDesigner";

type MemberCardDesignerProps = {
  members: MemberCard[];
  eventName: string;
  initialQrNumber?: string;
  onClose: () => void;
};

function MemberCardDesigner({
  members,
  eventName,
  initialQrNumber,
  onClose,
}: MemberCardDesignerProps) {
  const printableMembers =
    members.map(
      (member) => ({
        ...member,
        status:
          "未使用" as const,
        createdAt: "",
      })
    );

  return (
    <TicketDesigner
      tickets={
        printableMembers
      }
      eventName={eventName}
      initialTicketNumber={
        initialQrNumber
      }
      designKind="member"
      onClose={onClose}
    />
  );
}

export default MemberCardDesigner;
