using UnityEngine;

namespace RunToExit.Core
{
    public enum DoorType
    {
        Manual,  // 誰でも開けられる
        Locked,  // 鍵が必要
        Switch   // スイッチ連動（手動では開かない）
    }

    public class Door : InteractableBase
    {
        public DoorType Type = DoorType.Manual;
        public bool IsOpen { get; private set; } = false;

        public override bool IsObstacle(CharacterBase character) => !IsOpen;

        public override void OnInteract(CharacterBase character)
        {
            if (IsOpen) return;

            if (Type == DoorType.Manual)
            {
                OpenDoor();
            }
            else if (Type == DoorType.Locked)
            {
                if (character.HeldItem == ItemType.Key)
                {
                    Debug.Log($"{character.gameObject.name} unlocked the door!");
                    // 鍵を消費する処理
                    character.ConsumeItem();
                    OpenDoor();
                }
                else
                {
                    Debug.Log("This door is locked. You need a key.");
                }
            }
            else if (Type == DoorType.Switch)
            {
                Debug.Log("This door is controlled by a switch.");
            }
        }

        public void OpenDoor()
        {
            IsOpen = true;
            if (TryGetComponent<SpriteRenderer>(out var sr)) sr.color = new Color(1, 1, 1, 0.3f);
            if (TryGetComponent<Collider2D>(out var col)) col.enabled = false;
        }

        public void CloseDoor()
        {
            IsOpen = false;
            if (TryGetComponent<SpriteRenderer>(out var sr)) sr.color = new Color(1, 1, 1, 1f);
            if (TryGetComponent<Collider2D>(out var col)) col.enabled = true;
        }
    }
}
