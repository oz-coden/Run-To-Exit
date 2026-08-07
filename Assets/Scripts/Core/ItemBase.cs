using UnityEngine;

namespace RunToExit.Core
{
    public enum ItemType
    {
        Extinguisher,
        Key, // 将来用
        Rope // 将来用
    }

    public class ItemBase : InteractableBase
    {
        public ItemType itemType;

        public override void OnInteract(CharacterBase character)
        {
            if (character.HeldItem == null)
            {
                character.PickUpItem(this);
            }
            else
            {
                Debug.Log($"{character.gameObject.name} already holds an item.");
            }
        }
    }
}
